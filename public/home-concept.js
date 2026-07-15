function initializeHomeConcept() {
  document.querySelectorAll("[data-console-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const selectedTab = button.dataset.consoleTab;
      document.querySelectorAll("[data-console-tab]").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
      });
      document.querySelectorAll(".home-console-pane").forEach((pane) => {
        pane.classList.toggle("active", pane.id === `pane-${selectedTab}`);
      });
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeHomeConcept);
} else {
  initializeHomeConcept();
}
