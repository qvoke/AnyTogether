// Script to inject Shaka config changes into app.js
const fs = require('fs');
let c = fs.readFileSync('public/app.js', 'utf8');

// 1. Fix: remove resolution from Shaka control panel 
const needle = "  const ui = new window.shaka.ui.Overlay(player, getShakaContainer(), elements.player);\n\n  state.shakaPlayer = player;\n  state.shakaUi = ui;";

const replacement = "  const ui = new window.shaka.ui.Overlay(player, getShakaContainer(), elements.player);\n\n  // Remove resolution from Shaka settings — we use our own quality picker\n  try { player.configure({ ui: { controlPanelElements: ['play_pause', 'time_and_duration', 'spacer', 'mute', 'volume', 'fullscreen', 'overflow_menu'] } }); } catch(e) {}\n\n  state.shakaPlayer = player;\n  state.shakaUi = ui;";

if (c.includes(needle)) {
  c = c.replace(needle, replacement);
  fs.writeFileSync('public/app.js', c);
  console.log('Done - Shaka config updated');
} else {
  console.log('Needle not found - file may already be updated');
}