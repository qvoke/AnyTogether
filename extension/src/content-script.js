const PAGE_TO_EXTENSION_EVENT = "WT_SEARCH_REQUEST";
const PAGE_TO_RESOLVE_EVENT = "WT_RESOLVE_PAGE_URL";
const PAGE_TO_EXTENSION_PING_EVENT = "WT_EXTENSION_PING";
const EXTENSION_TO_PAGE_EVENT = "WT_MEDIA_FOUND";
const EXTENSION_TO_PAGE_SERIES_CONTEXT_EVENT = "WT_SERIES_CONTEXT_FOUND";
const EXTENSION_STATUS_EVENT = "WT_EXTENSION_STATUS";
const EXTENSION_ERROR_EVENT = "WT_EXTENSION_ERROR";
const PAGE_EVENT_SEARCH_RESULT_CLICKED = "WT_SEARCH_RESULT_CLICKED";
const SEARCH_POPUP_WINDOW_NAME = "AnyTogetherSearch";

  function sendRuntimeMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch {
      // The extension can disconnect while the page is still dispatching updates.
  }
}

(function() {
  const isIframe = window !== window.top;
  const pageUrl = window.location.href;
  const isSearchPopupWindow = window.name === SEARCH_POPUP_WINDOW_NAME;
  const isLocalUiPage = pageUrl.includes("localhost:3000");

  console.log("[AnyTogether CS] Loaded at:", pageUrl, "| isIframe:", isIframe);

  function injectSearchPopupToolbar() {
    if (!isSearchPopupWindow || document.getElementById("anytogether-popup-toolbar")) {
      return;
    }

    const toolbar = document.createElement("div");
    toolbar.id = "anytogether-popup-toolbar";
    toolbar.style.cssText = [
      "position:fixed",
      "top:8px",
      "left:8px",
      "z-index:2147483647",
      "display:flex",
      "gap:4px",
      "padding:4px",
      "border-radius:8px",
      "background:rgba(10,17,34,0.92)",
      "border:1px solid rgba(255,255,255,0.12)",
      "box-shadow:0 8px 18px rgba(0,0,0,0.3)",
      "backdrop-filter:blur(10px)"
    ].join(";");

    const makeButton = (direction, action, title) => {
      const button = document.createElement("button");
      button.type = "button";
      button.title = title;
      button.style.cssText = [
        "width:20px",
        "height:20px",
        "display:grid",
        "place-items:center",
        "padding:0",
        "border:none",
        "background:transparent",
        "color:#fff",
        "font:inherit",
        "cursor:pointer"
      ].join(";");
      button.innerHTML = direction === "back"
        ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 6l-6 6 6 6"></path><path d="M20 12H8"></path></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6l6 6-6 6"></path><path d="M4 12h12"></path></svg>';
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      });
      return button;
    };

    toolbar.appendChild(makeButton("back", () => window.history.back(), "Go to the previous page"));
    toolbar.appendChild(makeButton("forward", () => window.history.forward(), "Go to the next page"));

    const mount = document.body || document.documentElement;
    if (mount) {
      mount.appendChild(toolbar);
    }
  }

  if (isSearchPopupWindow) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", injectSearchPopupToolbar, { once: true });
    } else {
      injectSearchPopupToolbar();
    }
  }

  function postToPage(type, payload) {
    window.postMessage({ type, payload }, "*");
    if (isIframe) {
      try { window.top.postMessage({ type, payload }, "*"); }
      catch(e) {
        try { if (window.parent) window.parent.postMessage({ type, payload }, "*"); }
        catch(e2) {}
      }
    }
  }

  function isSeriesContextPayload(seriesContext) {
    if (!seriesContext) return false;
    const seasons = Array.isArray(seriesContext.seasons) ? seriesContext.seasons : [];
    const episodes = Array.isArray(seriesContext.episodes) ? seriesContext.episodes : [];
    return seasons.length > 0 || episodes.length > 0;
  }

  function persistPendingMediaPayload(payload) {
    try {
      chrome.storage.local.set(
        {
          pendingMediaUrl: {
            type: "WT_MEDIA_FOUND",
            timestamp: Date.now(),
            payload
          }
        },
        () => void chrome.runtime.lastError
      );
    } catch (e) {}
  }

  function sendMediaUrlToUi(mediaUrl, pUrl, seriesContext) {
    if (!mediaUrl) return;
    _lastMediaUrl = mediaUrl;
    const key = mediaUrl.substring(0, 80);
    const meaningfulSeriesContext = isSeriesContextPayload(seriesContext) ? seriesContext : null;

    if (_monitoredUrls.has(key)) {
      return;
    }
    _monitoredUrls.add(key);

    console.log("[AnyTogether CS] Media URL:", mediaUrl.substring(0, 100));

    const data = {
      type: "WT_MEDIA_FOUND",
      timestamp: Date.now(),
        payload: {
          roomId: null,
          mediaUrl: mediaUrl,
          masterPlaylistUrl: null,
          pageUrl: pUrl || mediaUrl,
          sourcePageUrl: pUrl || mediaUrl,
          seriesContext: meaningfulSeriesContext
        }
      };

    try { chrome.storage.local.set({ pendingMediaUrl: data }, () => void chrome.runtime.lastError); } catch(e) {}
    sendRuntimeMessage({ type: "WT_MEDIA_FOUND", payload: data.payload });
  }

  function isValidMediaUrl(url) {
    if (!url) return false;
    if (/\.ts(?:\?|$)/i.test(url)) return false;
    if (url.startsWith('blob:')) return false;
    if (/\.m3u8(?:\?|$)/i.test(url)) return true;
    if (/\.mp4(?:\?|$)/i.test(url)) return true;
    if (/voidboost.*manifest\.m3u8/i.test(url)) return true;
    if (/voidboost.*index\.m3u8/i.test(url)) return true;
    return false;
  }

  let _lastMediaUrl = null;

  if (!isLocalUiPage) {
    document.querySelectorAll('video, video source, source').forEach(el => {
      const url = el.currentSrc || el.src || '';
      if (isValidMediaUrl(url)) sendMediaUrlToUi(url, window.location.href);
    });

    const observer = new MutationObserver(() => {
      document.querySelectorAll('video, video source, source').forEach(el => {
        const url = el.currentSrc || el.src || '';
        if (isValidMediaUrl(url)) sendMediaUrlToUi(url, window.location.href);
      });
    });

    const target = document.querySelector('body') || document.documentElement;
    if (target) observer.observe(target, { childList: true, subtree: true });
  }

  let _monitoredUrls = new Set();

  console.log("[AnyTogether CS] Ready");

  window.addEventListener("message", (event) => {
    const fromParent = event.source === window.parent && event.source !== window;
    if (event.source !== window && !fromParent) return;

  if (event.data?.type === PAGE_TO_EXTENSION_PING_EVENT) {
    postToPage(EXTENSION_STATUS_EVENT, {
      message: "Extension detected",
      probe: true
    });
    return;
  }

    // Handle sniffer state toggle from UI page
    if (event.data?.type === "WT_SNIFFER_STATE") {
      sendRuntimeMessage({ type: "WT_SNIFFER_STATE", payload: event.data.payload });
      return;
    }

    if (event.data?.type !== PAGE_TO_EXTENSION_EVENT && event.data?.type !== PAGE_TO_RESOLVE_EVENT) return;

    chrome.runtime.sendMessage({ type: event.data.type, payload: event.data.payload }, (response) => {
      if (chrome.runtime.lastError) return;
      if (!response?.ok) return;
      postToPage(EXTENSION_TO_PAGE_EVENT, {
        roomId: event.data.payload.roomId,
        mediaUrl: response.mediaUrl,
        masterPlaylistUrl: response.masterPlaylistUrl || null,
        pageUrl: response.pageUrl,
        seriesContext: response.seriesContext || null
      });
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === EXTENSION_STATUS_EVENT) postToPage(EXTENSION_STATUS_EVENT, message.payload);
    if (message?.type === EXTENSION_ERROR_EVENT) postToPage(EXTENSION_ERROR_EVENT, message.payload);
    if (message?.type === EXTENSION_TO_PAGE_SERIES_CONTEXT_EVENT && message?.payload) {
      postToPage(EXTENSION_TO_PAGE_SERIES_CONTEXT_EVENT, message.payload);
    }
    if (message?.type === "WT_MEDIA_FOUND" && message?.payload) {
      _lastMediaUrl = message.payload.mediaUrl || _lastMediaUrl;
      if (pageUrl.includes("localhost:3000")) {
        persistPendingMediaPayload(message.payload);
      }
      postToPage("WT_MEDIA_FOUND", message.payload);
    }
  });

})();
