/* No Distract by Wasted — popup.js
 * Loads saved settings into the toggle switches and writes any change
 * straight back to chrome.storage.sync. Content scripts and the
 * background worker listen for storage changes and react live, so
 * nothing else needs to happen here.
 */

const DEFAULT_SETTINGS = {
  hideSidebar: false,
  hideGuide: false,
  homeFeedFilter: false,
  masterEnabled: true,
  blockShorts: false,
  adBlock: false,
  blockPopups: false,
  darkReader: false,
  bwMode: false,
};

const TOGGLE_IDS = [
  "masterEnabled",
  "hideSidebar",
  "hideGuide",
  "homeFeedFilter",
  "blockShorts",
  "adBlock",
  "blockPopups",
  "darkReader",
  "bwMode",
];

function loadSettings() {
  chrome.storage.sync.get({ nsSettings: DEFAULT_SETTINGS }, (res) => {
    const settings = { ...DEFAULT_SETTINGS, ...res.nsSettings };
    TOGGLE_IDS.forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.checked = !!settings[id];
    });
    reflectMaster();
  });
}

function reflectMaster() {
  const m = document.getElementById("masterEnabled");
  document.body.classList.toggle("is-off", !!m && !m.checked);
}

function saveSettings() {
  reflectMaster();
  const settings = {};
  TOGGLE_IDS.forEach((id) => {
    const input = document.getElementById(id);
    settings[id] = input ? input.checked : DEFAULT_SETTINGS[id];
  });

  chrome.storage.sync.set({ nsSettings: settings }, () => {
    const status = document.getElementById("status");
    if (!status) return;
    status.textContent = "CONFIG SAVED";
    window.clearTimeout(saveSettings._timer);
    saveSettings._timer = window.setTimeout(() => {
      status.textContent = "SYSTEM READY";
    }, 1400);
  });
}

function showVersion() {
  const versionEl = document.getElementById("version");
  if (!versionEl || !chrome.runtime.getManifest) return;
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = "v" + manifest.version;
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  showVersion();
  TOGGLE_IDS.forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener("change", saveSettings);
  });
});
