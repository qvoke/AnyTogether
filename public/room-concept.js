function toggleRoomPanel(panel) {
  if (!panel) return;

  panel.classList.toggle("is-collapsed");
  const isCollapsed = panel.classList.contains("is-collapsed");
  panel.querySelector(".concept-panel-header")?.setAttribute("aria-expanded", String(!isCollapsed));
}

function alignPickerMenu(details) {
  const menu = details.querySelector(".concept-picker-menu");
  if (!menu || !details.open) return;

  menu.classList.remove("is-left-aligned", "is-right-aligned", "is-picker-opening");
  menu.classList.add("is-fixed-positioned");
  menu.style.left = "0px";
  menu.style.top = "0px";

  requestAnimationFrame(() => {
    if (!details.open) return;
    const anchor = details.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    const edgePadding = 17;
    const minLeft = edgePadding;
    const maxLeft = Math.max(minLeft, window.innerWidth - rect.width - edgePadding);
    const centeredLeft = anchor.left + (anchor.width - rect.width) / 2;
    const left = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
    const aboveTop = anchor.top - rect.height - 6;
    const top = aboveTop >= edgePadding ? aboveTop : anchor.bottom + 6;

    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(edgePadding, top)}px`;
    void menu.offsetWidth;
    menu.classList.add("is-picker-opening");
  });
}

function resetPickerMenu(details) {
  const menu = details.querySelector(".concept-picker-menu");
  if (!menu) return;

  menu.classList.remove("is-fixed-positioned", "is-left-aligned", "is-right-aligned", "is-picker-opening");
  menu.style.removeProperty("left");
  menu.style.removeProperty("top");
  menu.style.removeProperty("bottom");
}

function closeOtherPickers(activeDetails) {
  document.querySelectorAll("#seriesPanel .concept-up-next-controls details[open]").forEach((details) => {
    if (details !== activeDetails) details.removeAttribute("open");
  });
}

function initializePickerBehavior() {
  const pickers = document.querySelectorAll("#seriesPanel .concept-up-next-controls details");

  pickers.forEach((details) => {
    details.addEventListener("toggle", () => {
      if (!details.open) {
        resetPickerMenu(details);
        return;
      }
      closeOtherPickers(details);
      alignPickerMenu(details);
    });
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("#seriesPanel .concept-up-next-controls details")) return;
    pickers.forEach((details) => details.removeAttribute("open"));
  });
}

function initializeRoomConcept() {
  initializePickerBehavior();

  document.querySelectorAll("[data-toggle-panel]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      toggleRoomPanel(document.getElementById(toggle.dataset.togglePanel));
    });
  });

  document.querySelectorAll("[data-current-room-shell] .concept-panel-header").forEach((toggle) => {
    toggle.setAttribute("aria-expanded", "true");
    toggle.addEventListener("click", () => toggleRoomPanel(toggle.closest(".concept-sidebar-panel")));
  });

  document.getElementById("conceptAddPlaylistButton")?.addEventListener("click", () => {
    window.anyTogetherUI?.addCurrentMediaToPlaylist?.();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeRoomConcept);
} else {
  initializeRoomConcept();
}
