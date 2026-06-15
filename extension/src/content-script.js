const PAGE_TO_EXTENSION_EVENT = "WT_SEARCH_REQUEST";
const PAGE_TO_RESOLVE_EVENT = "WT_RESOLVE_PAGE_URL";
const EXTENSION_TO_PAGE_EVENT = "WT_MEDIA_FOUND";
const EXTENSION_STATUS_EVENT = "WT_EXTENSION_STATUS";
const EXTENSION_ERROR_EVENT = "WT_EXTENSION_ERROR";

function postToPage(type, payload) {
  window.postMessage({ type, payload }, "*");
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== PAGE_TO_EXTENSION_EVENT && event.data?.type !== PAGE_TO_RESOLVE_EVENT) return;

  postToPage(EXTENSION_STATUS_EVENT, {
    message:
      event.data?.type === PAGE_TO_RESOLVE_EVENT
        ? `Extension received page request: ${event.data.payload.pageUrl}`
        : `Extension received search request: ${event.data.payload.query}`
  });

  chrome.runtime.sendMessage(
    {
      type: event.data.type,
      payload: event.data.payload
    },
    (response) => {
      if (chrome.runtime.lastError) {
        postToPage(EXTENSION_ERROR_EVENT, {
          message: chrome.runtime.lastError.message
        });
        return;
      }

      if (!response?.ok) {
        postToPage(EXTENSION_ERROR_EVENT, {
          message: response?.error || "Search request failed"
        });
        return;
      }

      postToPage(EXTENSION_STATUS_EVENT, {
        message: "Media URL captured, forwarding to the page"
      });

      postToPage(EXTENSION_TO_PAGE_EVENT, {
        roomId: event.data.payload.roomId,
        mediaUrl: response.mediaUrl,
        pageUrl: response.pageUrl,
        seriesContext: response.seriesContext || null
      });
    }
  );
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === EXTENSION_STATUS_EVENT) {
    postToPage(EXTENSION_STATUS_EVENT, message.payload);
  }

  if (message?.type === EXTENSION_ERROR_EVENT) {
    postToPage(EXTENSION_ERROR_EVENT, message.payload);
  }
});
