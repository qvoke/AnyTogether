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
      ${isHome ? `
        <div data-home-auth-controls>
          <button id="homeSignInButton" class="btn btn-ghost btn-sm">Sign in</button>
          <button id="homeSignUpButton" class="btn btn-primary btn-sm">Sign up</button>
        </div>
      ` : ""}
      <div id="topbarUser" data-topbar-user class="topbar-user hidden" style="display:flex;align-items:center;gap:6px">
        <span id="topbarNickDisplay" data-topbar-nick>Guest</span>
        <button id="topbarAvatarButton" data-topbar-avatar-button class="topbar-avatar" type="button" aria-expanded="false" aria-label="Open account menu">
          <span id="topbarAvatar" data-topbar-avatar>G</span>
        </button>
        <div id="topbarUserMenu" data-topbar-user-menu class="topbar-user-menu hidden">
          <button id="languageMenuButton" data-topbar-language-button type="button"><span id="languageMenuLabel" data-topbar-language-label></span></button>
          <div id="languageMenuDropdown" data-topbar-language-dropdown>
            <button id="languageEnglishButton" data-topbar-language-en type="button"></button>
            <button id="languageRussianButton" data-topbar-language-ru type="button"></button>
          </div>
          <button id="signOutButton" data-topbar-signout type="button"><span>Sign out</span></button>
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
