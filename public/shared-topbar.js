const topbarSlots = document.querySelectorAll("[data-topbar-slot]");

function renderBrandLogos(root = document) {
  root.querySelectorAll(".brand-logo").forEach((logo) => {
    logo.replaceChildren();
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 5.5v13l10-6.5-10-6.5Z");
    icon.appendChild(path);
    logo.appendChild(icon);
  });
}

function createTopbarMarkup(view) {
  const isHome = view === "home";
  const isRooms = view === "rooms";
  const isRoom = view === "room";
  const lastRoomId = `${view}LastRoomButton`;

  return `
    <header class="topbar shared-topbar shared-topbar-${view}" data-topbar-root>
      ${isRoom ? `
        <div class="shared-brand-nav">
          <a id="homeLink" class="brand" href="./" aria-label="AnyTogether home">
            <div class="brand-logo"></div>
            <span class="brand-text">Any<b>Together</b></span>
          </a>
          <a id="roomsLink" data-topbar-rooms-link class="topbar-pill" href="./?page=rooms">Rooms</a>
        </div>
      ` : `
        <a id="homeLink" class="brand" href="./" aria-label="AnyTogether home">
          <div class="brand-logo"></div>
          <span class="brand-text">Any<b>Together</b></span>
        </a>
      `}
      <div class="topbar-sep"></div>
      ${isRoom ? `
        <div class="shared-room-media-tools">
          <button class="shared-platform-button" type="button" aria-label="Choose platform"><span>▣</span><span>Choose platform</span></button>
        </div>
      ` : ""}
      ${!isRoom ? `
        <a id="roomsLink" data-topbar-rooms-link class="topbar-pill" href="./?page=rooms">Rooms</a>
      ` : ""}
      <button id="${lastRoomId}" data-last-room class="topbar-pill topbar-pill-accent" type="button">Last room ›</button>
      <span class="topbar-spacer"></span>
      <div class="concept-room-topbar-user shared-topbar-user" aria-label="User controls">
        <button class="concept-language-button" data-topbar-language-button type="button" aria-label="Choose language" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.4 3.6 5.4 3.6 9S14.4 20 12 21c-2.4-1-3.6-4.6-3.6-9S9.6 4 12 3Z"/></svg></button>
        <div class="concept-language-menu hidden" data-topbar-language-dropdown>
          <button data-topbar-language-en type="button">English</button>
          <button data-topbar-language-ru type="button">Русский</button>
        </div>
        <div class="topbar-auth-controls" data-topbar-auth-controls>
          <button data-topbar-signin type="button">Sign in</button>
          <button data-topbar-signup type="button">Sign up</button>
        </div>
        <span class="concept-room-topbar-name" data-topbar-account data-room-topbar-nick>Guest</span>
        <button class="concept-room-topbar-avatar" data-topbar-account data-topbar-avatar-button type="button" aria-expanded="false" aria-label="Open account menu"><span data-room-topbar-avatar>G</span></button>
        <div class="topbar-user-menu concept-room-user-menu hidden" data-topbar-account data-topbar-user-menu>
          <button data-topbar-change-nickname type="button"><span class="topbar-menu-icon" aria-hidden="true">✎</span><span>Change name</span></button>
          <button data-topbar-signout type="button"><span class="topbar-menu-icon" aria-hidden="true">↩</span><span>Sign out</span></button>
        </div>
      </div>
      ${isRooms || isRoom ? `
        <button id="topbarRoomCodeButton" class="topbar-pill topbar-pill-accent hidden" type="button">
          <small>Room</small> <span id="topbarRoomCodeValue">--</span>
        </button>
      ` : ""}
      <button id="reconnectButton" class="hidden" type="button">R</button>
    </header>
  `;
}

topbarSlots.forEach((slot) => {
  const requestedView = slot.dataset.topbarSlot;
  const hasRoomQuery = Boolean(new URLSearchParams(window.location.search).get("room"));
  const view = requestedView === "home" && hasRoomQuery ? "room" : requestedView;
  slot.innerHTML = createTopbarMarkup(view);
  renderBrandLogos(slot);
});

renderBrandLogos();

document.querySelectorAll("[data-legacy-topbar]").forEach((legacyTopbar) => {
  legacyTopbar.remove();
});
