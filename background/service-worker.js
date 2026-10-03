// Background service worker for Bleepr
// Handles storage initialization, badge counters, and cross-tab event coordination

const DEFAULT_SETTINGS = {
  enabled: true,
  censorMode: 'beep_and_mute', // 'beep_and_mute' | 'mute_only' | 'duck_and_beep'
  beepVolume: 0.8, // 0.0 - 1.0
  beepPitch: 1000, // 1000 Hz standard censor frequency
  maskSubtitles: true, // Visually replace profanity in subtitles with asterisks
  maskStyle: 'asterisk', // 'asterisk' (f***) or 'tag' ([beep])
  duckVolume: 0.1, // Volume during audio ducking
  timingPaddingMs: 60, // Slight pre/post padding to ensure word is fully covered
  categories: {
    strong: true, // fuck, cunt, motherfucker, etc.
    moderate: true, // shit, bitch, asshole, etc.
    mild: false, // damn, hell, crap
    slurs: true, // discriminatory slurs
    sexual: true // explicit anatomical terms
  },
  customBlacklist: [],
  customWhitelist: [],
  allTimeBleepCount: 0
};

// Initialize settings on install or update
chrome.runtime.onInstalled.addListener(async (details) => {
  const existing = await chrome.storage.local.get(null);
  const updated = { ...DEFAULT_SETTINGS };

  for (const [key, value] of Object.entries(existing)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      updated[key] = { ...updated[key], ...value };
    } else {
      updated[key] = value;
    }
  }

  await chrome.storage.local.set(updated);
  console.log('[Bleepr SW] Extension initialized with settings:', updated);
});

// Update badge count per tab or increment global counters
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BLEEP_OCCURRED') {
    (async () => {
      // Increment tab-specific count
      if (sender.tab && sender.tab.id) {
        const tabId = sender.tab.id;
        const count = message.tabCount || 1;
        await chrome.action.setBadgeText({ tabId, text: String(count) });
        await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' });
      }

      // Increment all-time count
      const { allTimeBleepCount = 0 } = await chrome.storage.local.get('allTimeBleepCount');
      const newTotal = allTimeBleepCount + 1;
      await chrome.storage.local.set({ allTimeBleepCount: newTotal });

      sendResponse({ success: true, allTimeBleepCount: newTotal });
    })();
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_TAB_INFO') {
    (async () => {
      sendResponse({ status: 'active' });
    })();
    return true;
  }
});
