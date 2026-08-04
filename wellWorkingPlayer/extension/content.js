const bridgePort = chrome.runtime.connect({ name: "anytogether-bridge" });

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== "anytogether-web") {
    return;
  }

  if (message.type !== "anytogether-plugin:search-request") {
    return;
  }

  bridgePort.postMessage({
    type: message.type,
    requestId: typeof message.requestId === "string" ? message.requestId : "",
    room: typeof message.room === "string" ? message.room : "",
    role: typeof message.role === "string" ? message.role : "",
    query: typeof message.query === "string" ? message.query : ""
  });
});

bridgePort.onMessage.addListener((message) => {
  if (!message || typeof message.type !== "string") {
    return;
  }

  window.postMessage(
    {
      source: "anytogether-plugin",
      ...message
    },
    window.location.origin
  );
});
