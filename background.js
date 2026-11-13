/* No Distract by Wasted — background.js
 * Keeps the network-level ad-blocking ruleset in sync with the user's
 * saved settings (toggled from popup.html), and seeds default settings
 * on first install.
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

const AD_RULESET_ID = "ads_ruleset";

async function applyAdBlockRuleset(enabled) {
  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [AD_RULESET_ID],
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        disableRulesetIds: [AD_RULESET_ID],
      });
    }
  } catch (err) {
    console.error("No Distract by Wasted: failed to update ad-block ruleset", err);
  }
}

async function syncRulesetWithStoredSettings() {
  const { nsSettings } = await chrome.storage.sync.get({
    nsSettings: DEFAULT_SETTINGS,
  });
  await applyAdBlockRuleset(
    nsSettings.masterEnabled !== false && nsSettings.adBlock
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  const { nsSettings } = await chrome.storage.sync.get({
    nsSettings: DEFAULT_SETTINGS,
  });
  // Ensure a settings object always exists, merging in any new keys that
  // might be added in future versions without clobbering saved choices.
  await chrome.storage.sync.set({
    nsSettings: { ...DEFAULT_SETTINGS, ...nsSettings },
  });
  await syncRulesetWithStoredSettings();
});

chrome.runtime.onStartup.addListener(() => {
  syncRulesetWithStoredSettings();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.nsSettings) {
    const newSettings = changes.nsSettings.newValue || DEFAULT_SETTINGS;
    applyAdBlockRuleset(
      newSettings.masterEnabled !== false && newSettings.adBlock
    );
  }
});
