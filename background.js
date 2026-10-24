const OFFSCREEN_DOCUMENT = "offscreen.html";
const OFFSCREEN_URL = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
const zipJobs = new Map();
let creatingOffscreen = null;

function isBoardPage(url) {
  return /^https?:\/\/(boards\.4chan\.org|boards\.4channel\.org)\//i.test(url || "");
}

function isAllowedImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return (
      /(^|\.)4cdn\.org$/i.test(url.hostname) ||
      /(^|\.)4chan\.org$/i.test(url.hostname) ||
      /(^|\.)4channel\.org$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function sanitizeFileName(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 180);
  return cleaned || fallback;
}

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [OFFSCREEN_URL]
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["BLOBS"],
    justification: "Create ZIP archives and blob download URLs for gallery images."
  });

  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function downloadOne(message) {
  if (!isAllowedImageUrl(message.url)) {
    return { ok: false, error: "That image URL is not allowed." };
  }

  const fallback = "4chan_image";
  const filename = sanitizeFileName(message.filename, fallback);

  try {
    const downloadId = await chrome.downloads.download({
      url: message.url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });
    return { ok: true, downloadId };
  } catch (error) {
    return { ok: false, error: error.message || "The download could not be started." };
  }
}

async function startZip(message, sender) {
  const tabId = sender.tab?.id;
  if (typeof tabId !== "number") {
    return { ok: false, error: "The thread tab could not be identified." };
  }

  if (!message.jobId || !Array.isArray(message.images) || message.images.length === 0) {
    return { ok: false, error: "There are no images to include in the ZIP." };
  }

  const images = message.images
    .filter((item) => item && isAllowedImageUrl(item.url))
    .map((item) => ({
      url: item.url,
      filename: sanitizeFileName(item.filename, "image.jpg")
    }));

  if (images.length === 0) {
    return { ok: false, error: "No valid images were found for the ZIP." };
  }

  const filename = sanitizeFileName(message.filename, "4chan_images.zip");
  zipJobs.set(message.jobId, { tabId });

  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "create-zip",
      jobId: message.jobId,
      tabId,
      filename,
      images
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The ZIP worker did not start.");
    }

    return { ok: true, count: images.length };
  } catch (error) {
    zipJobs.delete(message.jobId);
    return { ok: false, error: error.message || "The ZIP could not be started." };
  }
}

async function cancelZip(message) {
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "cancel-zip",
      jobId: message.jobId
    });
    return response || { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || "The ZIP could not be cancelled." };
  }
}

function sendToTab(tabId, message) {
  if (typeof tabId !== "number") return;
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

async function handleZipReady(message) {
  const job = zipJobs.get(message.jobId);
  const tabId = job?.tabId ?? message.tabId;
  const failedCount = Array.isArray(message.failed) ? message.failed.length : 0;
  const filename = sanitizeFileName(message.filename, "4chan_images.zip");

  try {
    if (typeof message.url !== "string" || !message.url.startsWith("blob:")) {
      throw new Error("The ZIP download URL was invalid.");
    }

    await chrome.downloads.download({
      url: message.url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });

    sendToTab(tabId, {
      type: "zip-done",
      jobId: message.jobId,
      failedCount
    });
  } catch (error) {
    sendToTab(tabId, {
      type: "zip-error",
      jobId: message.jobId,
      cancelled: false,
      message: error.message || "The ZIP download could not be started."
    });
  } finally {
    zipJobs.delete(message.jobId);
  }
}

function handleZipProgress(message) {
  const job = zipJobs.get(message.jobId);
  sendToTab(job?.tabId ?? message.tabId, {
    type: "zip-progress",
    jobId: message.jobId,
    completed: message.completed,
    total: message.total,
    failed: message.failed
  });
}

function handleZipError(message) {
  const job = zipJobs.get(message.jobId);
  sendToTab(job?.tabId ?? message.tabId, {
    type: "zip-error",
    jobId: message.jobId,
    cancelled: Boolean(message.cancelled),
    message: message.message || "The ZIP could not be created."
  });
  zipJobs.delete(message.jobId);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "download-one") {
    downloadOne(message).then(sendResponse);
    return true;
  }

  if (message.type === "start-zip") {
    startZip(message, sender).then(sendResponse);
    return true;
  }

  if (message.type === "cancel-zip") {
    cancelZip(message).then(sendResponse);
    return true;
  }

  if (message.type === "zip-progress") {
    handleZipProgress(message);
    return false;
  }

  if (message.type === "zip-ready") {
    handleZipReady(message);
    return false;
  }

  if (message.type === "zip-error") {
    handleZipError(message);
    return false;
  }

  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (tab.url && !isBoardPage(tab.url)) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "toggle-gallery" });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await chrome.tabs.sendMessage(tab.id, { type: "toggle-gallery" });
    } catch {
      return;
    }
  }
});
