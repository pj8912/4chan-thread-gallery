(() => {
  const threadMatch = location.pathname.match(/^\/([a-z0-9]+)\/thread\/(\d+)/i);
  if (!threadMatch) return;

  if (window.__fourChanGalleryLoaded) return;
  window.__fourChanGalleryLoaded = true;

  const HOST_ID = "four-chan-gallery-root";
  const board = threadMatch[1].toLowerCase();
  const threadId = threadMatch[2];
  const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp)$/i;
  const THUMBNAIL_EXTENSION = /\/\d+s\.(jpe?g|png|gif|webp)$/i;
  const ALLOWED_HOSTS = new Set([
    "i.4cdn.org",
    "is2.4chan.org",
    "is2.4channel.org",
    "i.4pcdn.org"
  ]);

  const ICONS = {
    gallery:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    download:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    archive:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',
    left:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
    right:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    image:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    external:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>'
  };

  document.getElementById(HOST_ID)?.remove();

  let images = [];
  let selected = new Set();
  let overlayOpen = false;
  let lightboxIndex = -1;
  let lightboxToken = 0;
  let zipState = null;
  let toastTimer = null;
  let previousRootOverflow = "";
  let previousActiveElement = null;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.hidden = true;

  const shadow = host.attachShadow({ mode: "open" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = chrome.runtime.getURL("gallery.css");
  shadow.appendChild(stylesheet);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "fcg-trigger";
  trigger.setAttribute("aria-label", "Open thread image gallery");
  trigger.innerHTML = `${ICONS.gallery}<span class="fcg-trigger-label">Gallery</span><span class="fcg-trigger-count" data-fcg="trigger-count">0</span>`;
  shadow.appendChild(trigger);

  const overlay = document.createElement("div");
  overlay.className = "fcg-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="fcg-panel" role="dialog" aria-modal="true" aria-labelledby="fcg-title">
      <header class="fcg-header">
        <div class="fcg-heading">
          <div class="fcg-logo">${ICONS.gallery}</div>
          <div class="fcg-heading-text">
            <h1 class="fcg-title" id="fcg-title">Thread Gallery</h1>
            <p class="fcg-subtitle" data-fcg="subtitle"></p>
          </div>
        </div>
        <button type="button" class="fcg-icon-button" data-fcg="close" aria-label="Close gallery">${ICONS.close}</button>
      </header>
      <div class="fcg-toolbar">
        <label class="fcg-select-all">
          <input type="checkbox" class="fcg-select-all-input" data-fcg="select-all">
          <span class="fcg-checkbox-visual"></span>
          <span>Select all</span>
        </label>
        <span class="fcg-selection-count" data-fcg="selection-count">0 selected</span>
        <div class="fcg-actions">
          <button type="button" class="fcg-button fcg-secondary" data-fcg="download-selected" disabled>${ICONS.download}<span data-fcg="download-selected-label">Download selected</span></button>
          <button type="button" class="fcg-button fcg-primary" data-fcg="download-all" disabled>${ICONS.archive}<span>Download all as ZIP</span></button>
        </div>
      </div>
      <div class="fcg-progress" data-fcg="progress" hidden>
        <div class="fcg-progress-copy">
          <div class="fcg-progress-label" data-fcg="progress-label">Preparing ZIP</div>
          <div class="fcg-progress-detail" data-fcg="progress-detail">0 of 0 images</div>
        </div>
        <button type="button" class="fcg-button fcg-ghost" data-fcg="cancel">Cancel</button>
        <div class="fcg-progress-track"><div class="fcg-progress-bar" data-fcg="progress-bar"></div></div>
      </div>
      <div class="fcg-grid" data-fcg="grid"></div>
      <div class="fcg-empty" data-fcg="empty" hidden>
        <div class="fcg-empty-icon">${ICONS.image}</div>
        <strong>No images found</strong>
        <span>Open a thread with image attachments and try again.</span>
      </div>
    </section>
    <div class="fcg-lightbox" data-fcg="lightbox" hidden>
      <div class="fcg-lightbox-top">
        <div class="fcg-lightbox-meta">
          <div class="fcg-lightbox-name" data-fcg="lightbox-name"></div>
          <div class="fcg-lightbox-position" data-fcg="lightbox-position"></div>
        </div>
        <div class="fcg-lightbox-actions">
          <button type="button" class="fcg-button fcg-primary" data-fcg="lightbox-download">${ICONS.download}<span>Download</span></button>
          <button type="button" class="fcg-icon-button" data-fcg="lightbox-close" aria-label="Close preview">${ICONS.close}</button>
        </div>
      </div>
      <div class="fcg-lightbox-stage">
        <button type="button" class="fcg-nav fcg-prev" data-fcg="prev" aria-label="Previous image">${ICONS.left}</button>
        <div class="fcg-spinner" data-fcg="spinner"></div>
        <img class="fcg-lightbox-image" data-fcg="lightbox-image" alt="" hidden>
        <div class="fcg-lightbox-error" data-fcg="lightbox-error" hidden>
          <strong>Could not load this image</strong>
          <a data-fcg="lightbox-external" target="_blank" rel="noopener noreferrer">Open the original image</a>
        </div>
        <button type="button" class="fcg-nav fcg-next" data-fcg="next" aria-label="Next image">${ICONS.right}</button>
      </div>
      <div class="fcg-lightbox-caption" data-fcg="lightbox-caption"></div>
    </div>
    <div class="fcg-toast" data-fcg="toast" role="status" hidden></div>
  `;
  shadow.appendChild(overlay);

  const refs = {};
  overlay.querySelectorAll("[data-fcg]").forEach((element) => {
    const key = element.dataset.fcg.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    refs[key] = element;
  });
  refs.triggerCount = trigger.querySelector("[data-fcg='trigger-count']");

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function normalizeImageUrl(value) {
    if (!value) return null;

    try {
      const url = new URL(value, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
      if (!IMAGE_EXTENSION.test(url.pathname)) return null;
      url.protocol = "https:";
      url.hash = "";
      return url;
    } catch {
      return null;
    }
  }

  function fullSizeUrl(value) {
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/(\d+)s\.(jpe?g|png|gif|webp)$/i);
      if (!match) return url.href;
      url.pathname = url.pathname.replace(
        /\/\d+s\.(jpe?g|png|gif|webp)$/i,
        `/${match[1]}.${match[2]}`
      );
      return url.href;
    } catch {
      return value;
    }
  }

  function thumbnailUrl(fullUrl, sourceUrl) {
    if (sourceUrl && THUMBNAIL_EXTENSION.test(sourceUrl)) {
      return sourceUrl;
    }

    try {
      const url = new URL(fullUrl);
      const match = url.pathname.match(/\/(\d+)\.(jpe?g|png|gif|webp)$/i);
      if (!match) return fullUrl;
      url.pathname = url.pathname.replace(
        /\/\d+\.(jpe?g|png|gif|webp)$/i,
        `/${match[1]}s.jpg`
      );
      return url.href;
    } catch {
      return fullUrl;
    }
  }

  function extensionFromUrl(value) {
    try {
      const match = new URL(value).pathname.match(/\.(jpe?g|png|gif|webp)$/i);
      return match ? match[1].toLowerCase() : "jpg";
    } catch {
      return "jpg";
    }
  }

  function sanitizeName(value) {
    let cleaned = String(value || "")
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, "");

    if (cleaned.length > 150) {
      const dot = cleaned.lastIndexOf(".");
      const extension = dot > 0 && cleaned.length - dot <= 6 ? cleaned.slice(dot) : "";
      cleaned = cleaned.slice(0, 150 - extension.length).trim() + extension;
    }

    return cleaned || "image";
  }

  function makeFileName(value, fullUrl) {
    const extension = extensionFromUrl(fullUrl);
    let name = sanitizeName(value);

    if (!IMAGE_EXTENSION.test(name)) {
      name = name.replace(/\.[a-z0-9]{2,5}$/i, "") + `.${extension}`;
    }

    return name;
  }

  function extractImages() {
    const found = [];
    const seen = new Set();
    const anchors = document.querySelectorAll("a.fileThumb");

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute("href");
      const image = anchor.querySelector("img");
      const rawSource = image?.getAttribute("src") || image?.currentSrc || "";

      let candidate = rawHref ? normalizeImageUrl(rawHref) : null;
      if (!candidate && !rawHref && rawSource) {
        candidate = normalizeImageUrl(rawSource);
      }

      if (!candidate) continue;

      const fullUrl = fullSizeUrl(candidate.href);
      if (!normalizeImageUrl(fullUrl)) continue;
      if (seen.has(fullUrl)) continue;

      const sourceUrl = rawSource ? normalizeImageUrl(rawSource)?.href : "";
      const fileNameLink = anchor.closest(".file")?.querySelector(".fileText a");
      const originalName = fileNameLink?.textContent?.trim() || "";
      const extension = extensionFromUrl(fullUrl);
      const fallbackName = decodeURIComponent(new URL(fullUrl).pathname.split("/").pop() || "image");
      const name = makeFileName(originalName || fallbackName, fullUrl);
      const index = found.length + 1;

      seen.add(fullUrl);
      found.push({
        fullUrl,
        thumbUrl: thumbnailUrl(fullUrl, sourceUrl),
        name,
        extension,
        zipName: `${String(index).padStart(3, "0")}_${name}`,
        downloadName: sanitizeName(`4chan_${board}_${threadId}_${name}`)
      });
    }

    return found;
  }

  function refreshImages() {
    images = extractImages();

    const validUrls = new Set(images.map((item) => item.fullUrl));
    for (const url of selected) {
      if (!validUrls.has(url)) selected.delete(url);
    }

    refs.subtitle.textContent = `#${threadId} \u00b7 /${board}/ \u00b7 ${images.length} ${images.length === 1 ? "image" : "images"}`;
    refs.triggerCount.textContent = String(images.length);
    refs.empty.hidden = images.length !== 0;
    refs.grid.hidden = images.length === 0;
    refs.downloadAll.disabled = images.length === 0 || Boolean(zipState);
    renderGrid();
    updateSelection();
  }

  function renderGrid() {
    refs.grid.replaceChildren();
    const fragment = document.createDocumentFragment();

    images.forEach((item, index) => {
      const card = document.createElement("article");
      card.className = "fcg-card";
      card.classList.toggle("is-selected", selected.has(item.fullUrl));

      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "fcg-thumb-button";
      preview.setAttribute("aria-label", `Preview image ${index + 1}: ${item.name}`);
      preview.addEventListener("click", () => openLightbox(index));

      const image = document.createElement("img");
      image.src = item.thumbUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.draggable = false;
      image.addEventListener("load", () => image.classList.add("is-loaded"));
      image.addEventListener("error", () => {
        if (image.dataset.fallback !== "1" && item.thumbUrl !== item.fullUrl) {
          image.dataset.fallback = "1";
          image.src = item.fullUrl;
          return;
        }
        card.classList.add("is-broken");
      });

      preview.appendChild(image);

      const indexBadge = document.createElement("span");
      indexBadge.className = "fcg-index";
      indexBadge.textContent = String(index + 1);
      preview.appendChild(indexBadge);

      const extensionBadge = document.createElement("span");
      extensionBadge.className = "fcg-ext";
      extensionBadge.textContent = item.extension.toUpperCase();

      const selectLabel = document.createElement("label");
      selectLabel.className = "fcg-card-select";
      selectLabel.title = "Select image";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.has(item.fullUrl);
      checkbox.setAttribute("aria-label", `Select ${item.name}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selected.add(item.fullUrl);
        } else {
          selected.delete(item.fullUrl);
        }
        card.classList.toggle("is-selected", checkbox.checked);
        updateSelection();
      });

      const visual = document.createElement("span");
      visual.className = "fcg-checkbox-visual";

      selectLabel.append(checkbox, visual);

      const quickDownload = document.createElement("button");
      quickDownload.type = "button";
      quickDownload.className = "fcg-quick-download";
      quickDownload.title = `Download ${item.name}`;
      quickDownload.setAttribute("aria-label", `Download ${item.name}`);
      quickDownload.innerHTML = ICONS.download;
      quickDownload.addEventListener("click", (event) => {
        event.stopPropagation();
        downloadOne(item);
      });

      card.append(preview, extensionBadge, selectLabel, quickDownload);
      fragment.appendChild(card);
    });

    refs.grid.appendChild(fragment);
  }

  function updateSelection() {
    const total = images.length;
    const count = selected.size;
    const busy = Boolean(zipState);

    refs.selectionCount.textContent = `${count} selected`;
    refs.selectAll.checked = total > 0 && count === total;
    refs.selectAll.indeterminate = count > 0 && count < total;
    refs.downloadSelected.disabled = count === 0 || busy;
    refs.downloadAll.disabled = total === 0 || busy;
    refs.downloadSelectedLabel.textContent = count > 0 ? `Download selected (${count})` : "Download selected";
  }

  function openGallery() {
    if (overlayOpen) return;

    previousActiveElement = document.activeElement;
    refreshImages();
    overlayOpen = true;
    overlay.hidden = false;
    trigger.hidden = true;
    previousRootOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    refs.close.focus({ preventScroll: true });
  }

  function closeGallery() {
    if (!overlayOpen) return;

    closeLightbox();
    overlayOpen = false;
    overlay.hidden = true;
    trigger.hidden = false;
    document.documentElement.style.overflow = previousRootOverflow;

    if (previousActiveElement instanceof HTMLElement) {
      previousActiveElement.focus({ preventScroll: true });
    }
  }

  function toggleGallery() {
    if (overlayOpen) closeGallery();
    else openGallery();
  }

  function openLightbox(index) {
    if (!images[index]) return;

    lightboxIndex = index;
    refs.lightbox.hidden = false;
    updateLightbox();
    refs.lightboxClose.focus({ preventScroll: true });
  }

  function closeLightbox() {
    lightboxToken += 1;
    lightboxIndex = -1;
    refs.lightbox.hidden = true;
    refs.lightboxImage.removeAttribute("src");
    refs.lightboxImage.hidden = true;
    refs.lightboxError.hidden = true;
    refs.lightboxExternal.removeAttribute("href");
  }

  function updateLightbox() {
    const item = images[lightboxIndex];
    if (!item) return;

    const token = ++lightboxToken;
    refs.lightboxName.textContent = item.name;
    refs.lightboxPosition.textContent = `${lightboxIndex + 1} of ${images.length}`;
    refs.lightboxCaption.textContent = item.fullUrl;
    refs.spinner.hidden = false;
    refs.lightboxImage.hidden = true;
    refs.lightboxError.hidden = true;
    refs.lightboxImage.onload = () => {
      if (token !== lightboxToken) return;
      refs.spinner.hidden = true;
      refs.lightboxImage.hidden = false;
    };
    refs.lightboxImage.onerror = () => {
      if (token !== lightboxToken) return;
      refs.spinner.hidden = true;
      refs.lightboxError.hidden = false;
      refs.lightboxExternal.href = item.fullUrl;
    };
    refs.lightboxImage.src = item.fullUrl;

    preload(lightboxIndex - 1);
    preload(lightboxIndex + 1);
  }

  function preload(index) {
    if (images.length < 2) return;
    const wrapped = (index + images.length) % images.length;
    const item = images[wrapped];
    if (!item) return;
    const preloadImage = new Image();
    preloadImage.src = item.fullUrl;
  }

  function stepLightbox(direction) {
    if (lightboxIndex < 0 || images.length === 0) return;
    lightboxIndex = (lightboxIndex + direction + images.length) % images.length;
    updateLightbox();
  }

  async function downloadOne(item) {
    try {
      const response = await sendMessage({
        type: "download-one",
        url: item.fullUrl,
        filename: item.downloadName
      });

      if (!response?.ok) {
        throw new Error(response?.error || "The download could not be started.");
      }

      showToast(`Downloading ${item.name}`);
    } catch (error) {
      showToast(error.message || "The download could not be started.", true);
    }
  }

  function makeJobId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function startZip(items) {
    if (zipState || items.length === 0) return;

    const jobId = makeJobId();
    zipState = {
      jobId,
      total: items.length,
      completed: 0,
      failed: 0
    };

    refs.progress.hidden = false;
    refs.progressLabel.textContent = "Preparing ZIP";
    refs.progressDetail.textContent = `0 of ${items.length} images`;
    refs.progressBar.style.width = "0%";
    refs.cancel.disabled = false;
    updateSelection();

    try {
      const response = await sendMessage({
        type: "start-zip",
        jobId,
        filename: sanitizeName(`4chan_${board}_${threadId}_images.zip`),
        images: items.map((item) => ({
          url: item.fullUrl,
          filename: item.zipName
        }))
      });

      if (!response?.ok) {
        throw new Error(response?.error || "The ZIP could not be started.");
      }
    } catch (error) {
      zipState = null;
      refs.progress.hidden = true;
      updateSelection();
      showToast(error.message || "The ZIP could not be started.", true);
    }
  }

  function updateZipProgress(message) {
    if (!zipState || message.jobId !== zipState.jobId) return;

    zipState.completed = Number(message.completed) || 0;
    zipState.failed = Number(message.failed) || 0;

    const percent = zipState.total > 0 ? Math.round((zipState.completed / zipState.total) * 100) : 0;
    const failedText = zipState.failed > 0 ? ` \u00b7 ${zipState.failed} failed` : "";

    refs.progressLabel.textContent = "Creating ZIP";
    refs.progressDetail.textContent = `${zipState.completed} of ${zipState.total} images${failedText}`;
    refs.progressBar.style.width = `${percent}%`;
  }

  function finishZip(message) {
    if (!zipState || message.jobId !== zipState.jobId) return;

    const failedCount = Number(message.failedCount) || 0;
    zipState = null;
    refs.progress.hidden = true;
    refs.progressBar.style.width = "0%";
    updateSelection();

    if (failedCount > 0) {
      showToast(`ZIP download started. ${failedCount} ${failedCount === 1 ? "image" : "images"} could not be included.`);
    } else {
      showToast("ZIP download started.");
    }
  }

  function failZip(message) {
    if (!zipState || message.jobId !== zipState.jobId) return;

    const cancelled = Boolean(message.cancelled);
    zipState = null;
    refs.progress.hidden = true;
    refs.progressBar.style.width = "0%";
    updateSelection();
    showToast(cancelled ? "ZIP creation cancelled." : message.message || "The ZIP could not be created.", !cancelled);
  }

  async function cancelZip() {
    if (!zipState) return;

    const jobId = zipState.jobId;
    refs.cancel.disabled = true;
    refs.progressLabel.textContent = "Cancelling ZIP";
    refs.progressDetail.textContent = "Stopping downloads...";

    try {
      await sendMessage({ type: "cancel-zip", jobId });
    } catch {
      refs.cancel.disabled = false;
    }
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    refs.toast.textContent = message;
    refs.toast.classList.toggle("is-error", isError);
    refs.toast.classList.remove("is-visible");
    refs.toast.hidden = false;

    requestAnimationFrame(() => {
      refs.toast.classList.add("is-visible");
    });

    toastTimer = setTimeout(() => {
      refs.toast.classList.remove("is-visible");
      setTimeout(() => {
        refs.toast.hidden = true;
      }, 180);
    }, 3200);
  }

  function handleKeyDown(event) {
    if (!overlayOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!refs.lightbox.hidden) closeLightbox();
      else closeGallery();
      return;
    }

    if (!refs.lightbox.hidden && event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      stepLightbox(-1);
      return;
    }

    if (!refs.lightbox.hidden && event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      stepLightbox(1);
    }
  }

  trigger.addEventListener("click", openGallery);
  refs.close.addEventListener("click", closeGallery);
  refs.selectAll.addEventListener("change", () => {
    if (refs.selectAll.checked) {
      selected = new Set(images.map((item) => item.fullUrl));
    } else {
      selected.clear();
    }

    refs.grid.querySelectorAll(".fcg-card").forEach((card, index) => {
      const item = images[index];
      if (!item) return;
      card.classList.toggle("is-selected", selected.has(item.fullUrl));
      const checkbox = card.querySelector(".fcg-card-select input");
      if (checkbox) checkbox.checked = selected.has(item.fullUrl);
    });

    updateSelection();
  });

  refs.downloadSelected.addEventListener("click", () => {
    startZip(images.filter((item) => selected.has(item.fullUrl)));
  });
  refs.downloadAll.addEventListener("click", () => startZip(images));
  refs.cancel.addEventListener("click", cancelZip);

  refs.lightboxClose.addEventListener("click", closeLightbox);
  refs.prev.addEventListener("click", () => stepLightbox(-1));
  refs.next.addEventListener("click", () => stepLightbox(1));
  refs.lightboxDownload.addEventListener("click", () => {
    const item = images[lightboxIndex];
    if (item) downloadOne(item);
  });
  refs.lightboxExternal.addEventListener("click", (event) => event.stopPropagation());

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeGallery();
  });

  host.addEventListener("click", (event) => event.stopPropagation());
  host.addEventListener("mousedown", (event) => event.stopPropagation());
  host.addEventListener("mouseup", (event) => event.stopPropagation());
  host.addEventListener("keydown", (event) => event.stopPropagation());

  stylesheet.addEventListener("load", () => {
    host.hidden = false;
  });
  stylesheet.addEventListener("error", () => {
    host.hidden = false;
  });
  setTimeout(() => {
    host.hidden = false;
  }, 1000);

  document.addEventListener("keydown", handleKeyDown, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "toggle-gallery") {
      toggleGallery();
      return;
    }

    if (message.type === "zip-progress") {
      updateZipProgress(message);
      return;
    }

    if (message.type === "zip-done") {
      finishZip(message);
      return;
    }

    if (message.type === "zip-error") {
      failZip(message);
    }
  });

  refreshImages();
  (document.body || document.documentElement).appendChild(host);
})();
