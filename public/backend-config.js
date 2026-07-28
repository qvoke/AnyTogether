(function configureBackend(globalObject) {
  const storageKey = "watchTogether.backendBaseUrl";
  const hostedBackendBaseUrl = "https://anytogether-back.onrender.com/";

  function getDefaultBaseUrl() {
    const isLocalFrontend =
      (globalObject.location.hostname === "localhost" ||
        globalObject.location.hostname === "127.0.0.1") &&
      globalObject.location.port === "3000";

    return isLocalFrontend ? "http://localhost:3001/" : hostedBackendBaseUrl;
  }

  function normalizeBaseUrl(value) {
    const fallback = getDefaultBaseUrl();
    const raw = String(value || "").trim();
    if (!raw) return fallback;

    try {
      const url = new URL(raw, globalObject.location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return fallback;
      }

      url.hash = "";
      url.search = "";
      if (!url.pathname.endsWith("/")) {
        url.pathname = `${url.pathname}/`;
      }
      return url.href;
    } catch {
      return fallback;
    }
  }

  function getBaseUrl() {
    const queryValue = new URLSearchParams(globalObject.location.search).get("api");
    let storedValue = "";
    try {
      storedValue = globalObject.localStorage.getItem(storageKey) || "";
    } catch {
      storedValue = "";
    }

    const defaultBaseUrl = getDefaultBaseUrl();
    const localFrontendOrigin = `${globalObject.location.origin}/`;
    if (
      defaultBaseUrl !== localFrontendOrigin &&
      normalizeBaseUrl(storedValue) === localFrontendOrigin
    ) {
      storedValue = "";
    }

    return normalizeBaseUrl(
      queryValue ||
        globalObject.WATCH_TOGETHER_API_BASE_URL ||
        storedValue ||
        defaultBaseUrl
    );
  }

  function resolveUrl(path) {
    return new URL(String(path || "").replace(/^\/+/, ""), getBaseUrl()).href;
  }

  function resolveWebSocketUrl(path = "/ws") {
    const url = new URL(String(path || "").replace(/^\/+/, ""), getBaseUrl());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  }

  globalObject.AnyTogetherBackend = Object.freeze({
    getBaseUrl,
    getDefaultBaseUrl,
    normalizeBaseUrl,
    resolveUrl,
    resolveWebSocketUrl
  });
})(window);
