(function () {
  const jobs = new Map();
  const FETCH_CONCURRENCY = 4;
  const REVOKE_DELAY = 15 * 60 * 1000;

  function postBackground(message) {
    return chrome.runtime
      .sendMessage({ target: "background", ...message })
      .catch(() => {});
  }

  function safeName(value, fallback) {
    const cleaned = String(value || "")
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    return cleaned || fallback;
  }

  function extensionFromUrl(value) {
    try {
      const match = new URL(value).pathname.match(/\.([a-z0-9]{2,5})$/i);
      return match ? `.${match[1].toLowerCase()}` : "";
    } catch {
      return "";
    }
  }

  function fileNameFor(item, index) {
    const fallbackExtension = extensionFromUrl(item.url) || ".jpg";
    let name = safeName(item.filename, `${String(index + 1).padStart(3, "0")}${fallbackExtension}`);
    if (!/\.[a-z0-9]{2,5}$/i.test(name)) {
      name += fallbackExtension;
    }
    return name;
  }

  function uniqueName(name, usedNames) {
    let candidate = name;
    const dot = candidate.lastIndexOf(".");
    const base = dot > 0 ? candidate.slice(0, dot) : candidate;
    const extension = dot > 0 ? candidate.slice(dot) : "";
    let counter = 2;

    while (usedNames.has(candidate.toLowerCase())) {
      candidate = `${base}_${counter}${extension}`;
      counter += 1;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  function isCancelled(job) {
    if (job.cancelled) {
      const error = new Error("The ZIP creation was cancelled.");
      error.cancelled = true;
      throw error;
    }
  }

  async function fetchImages(images, job) {
    const results = new Array(images.length);
    const failed = [];
    let cursor = 0;
    let completed = 0;

    const report = () => {
      postBackground({
        type: "zip-progress",
        jobId: job.jobId,
        tabId: job.tabId,
        completed,
        total: images.length,
        failed: failed.length
      });
    };

    const worker = async () => {
      while (true) {
        if (job.cancelled) return;

        const index = cursor;
        cursor += 1;
        if (index >= images.length) return;

        const item = images[index];
        const controller = new AbortController();
        job.controllers.add(controller);

        try {
          const response = await fetch(item.url, {
            credentials: "omit",
            signal: controller.signal
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const buffer = await response.arrayBuffer();
          isCancelled(job);
          results[index] = {
            name: fileNameFor(item, index),
            data: new Uint8Array(buffer)
          };
        } catch (error) {
          if (!job.cancelled && error.name !== "AbortError") {
            failed.push({
              url: item.url,
              error: String(error.message || error).slice(0, 200)
            });
          }
        } finally {
          job.controllers.delete(controller);
          if (!job.cancelled) {
            completed += 1;
            report();
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(FETCH_CONCURRENCY, images.length) }, () => worker())
    );

    isCancelled(job);

    return {
      files: results.filter(Boolean),
      failed
    };
  }

  async function runJob(message) {
    const job = {
      jobId: message.jobId,
      tabId: message.tabId,
      cancelled: false,
      controllers: new Set()
    };
    jobs.set(job.jobId, job);

    try {
      postBackground({
        type: "zip-progress",
        jobId: job.jobId,
        tabId: job.tabId,
        completed: 0,
        total: message.images.length,
        failed: 0
      });

      const result = await fetchImages(message.images, job);
      if (result.files.length === 0) {
        throw new Error("None of the images could be downloaded.");
      }

      const usedNames = new Set();
      const files = result.files.map((file) => ({
        name: uniqueName(file.name, usedNames),
        data: file.data
      }));

      const zip = FourChanZip.build(files);
      const blob = new Blob(zip.parts, { type: "application/zip" });
      const url = URL.createObjectURL(blob);

      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY);

      jobs.delete(job.jobId);
      await postBackground({
        type: "zip-ready",
        jobId: job.jobId,
        tabId: job.tabId,
        url,
        filename: message.filename,
        failed: result.failed
      });
    } catch (error) {
      jobs.delete(job.jobId);
      await postBackground({
        type: "zip-error",
        jobId: job.jobId,
        tabId: job.tabId,
        cancelled: Boolean(job.cancelled || error.cancelled),
        message: job.cancelled ? "The ZIP creation was cancelled." : String(error.message || error)
      });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.target !== "offscreen") return false;

    if (message.type === "create-zip") {
      runJob(message);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "cancel-zip") {
      const job = jobs.get(message.jobId);
      if (job) {
        job.cancelled = true;
        for (const controller of job.controllers) {
          controller.abort();
        }
      }
      sendResponse({ ok: Boolean(job) });
      return false;
    }

    return false;
  });
})();
