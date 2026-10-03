// Bleepr Popup Controller
// Handles user preferences, audio testing, category filters, and live page diagnostics.

(function () {
  'use strict';

  let currentSettings = {};
  let audioContext = null;

  // DOM Elements
  const masterToggle = document.getElementById('master-toggle');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Sound Controls
  const censorModeRadios = document.querySelectorAll('input[name="censorMode"]');
  const beepVolumeSlider = document.getElementById('beep-volume');
  const volumeValBadge = document.getElementById('volume-val');
  const beepPitchSlider = document.getElementById('beep-pitch');
  const pitchValBadge = document.getElementById('pitch-val');
  const testBeepBtn = document.getElementById('test-beep-btn');
  const maskSubtitlesToggle = document.getElementById('mask-subtitles');
  const maskStyleSelect = document.getElementById('mask-style');
  const maskStyleContainer = document.getElementById('mask-style-container');

  // Filter Controls
  const catCheckboxes = {
    strong: document.getElementById('cat-strong'),
    moderate: document.getElementById('cat-moderate'),
    slurs: document.getElementById('cat-slurs'),
    sexual: document.getElementById('cat-sexual'),
    mild: document.getElementById('cat-mild')
  };

  // Blacklist & Whitelist
  const blacklistInput = document.getElementById('blacklist-input');
  const addBlacklistBtn = document.getElementById('add-blacklist-btn');
  const blacklistTags = document.getElementById('blacklist-tags');

  const whitelistInput = document.getElementById('whitelist-input');
  const addWhitelistBtn = document.getElementById('add-whitelist-btn');
  const whitelistTags = document.getElementById('whitelist-tags');

  // Stats & Status
  const tabBleepCountEl = document.getElementById('tab-bleep-count');
  const allTimeCountEl = document.getElementById('all-time-count');
  const statVideoEl = document.getElementById('stat-video');
  const statCaptionsEl = document.getElementById('stat-captions');
  const statPlatformEl = document.getElementById('stat-platform');
  const globalStatusText = document.getElementById('global-status-text');
  const statusIndicator = document.querySelector('.status-indicator');

  // Initialize
  document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    await loadSettings();
    initEventListeners();
    await queryActiveTabStatus();
  });

  // Tab switching
  function initTabs() {
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        const targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');
      });
    });
  }

  // Load settings from storage
  async function loadSettings() {
    const data = await chrome.storage.local.get(null);
    currentSettings = data;

    // Master switch
    masterToggle.checked = currentSettings.enabled !== false;
    updateGlobalStatusUI(masterToggle.checked);

    // Censor Mode
    const mode = currentSettings.censorMode || 'beep_and_mute';
    censorModeRadios.forEach(radio => {
      radio.checked = radio.value === mode;
    });

    // Beep Volume & Pitch
    const vol = typeof currentSettings.beepVolume === 'number' ? Math.round(currentSettings.beepVolume * 100) : 80;
    beepVolumeSlider.value = vol;
    volumeValBadge.textContent = `${vol}%`;

    const pitch = currentSettings.beepPitch || 1000;
    beepPitchSlider.value = pitch;
    pitchValBadge.textContent = `${pitch} Hz`;

    // Mask Subtitles
    maskSubtitlesToggle.checked = currentSettings.maskSubtitles !== false;
    maskStyleSelect.value = currentSettings.maskStyle || 'asterisk';
    maskStyleContainer.style.display = maskSubtitlesToggle.checked ? 'flex' : 'none';

    // Categories
    const cats = currentSettings.categories || {};
    for (const [key, checkbox] of Object.entries(catCheckboxes)) {
      if (checkbox) {
        checkbox.checked = cats[key] === true;
      }
    }

    // Blacklist & Whitelist Tags
    renderTags(blacklistTags, currentSettings.customBlacklist || [], removeBlacklistTag);
    renderTags(whitelistTags, currentSettings.customWhitelist || [], removeWhitelistTag);

    // All-time bleep count
    allTimeCountEl.textContent = String(currentSettings.allTimeBleepCount || 0);
  }

  // Event Listeners
  function initEventListeners() {
    // Master Toggle
    masterToggle.addEventListener('change', async () => {
      const enabled = masterToggle.checked;
      await saveSetting('enabled', enabled);
      updateGlobalStatusUI(enabled);
    });

    // Censor Mode Radios
    censorModeRadios.forEach(radio => {
      radio.addEventListener('change', async () => {
        if (radio.checked) {
          await saveSetting('censorMode', radio.value);
        }
      });
    });

    // Volume Slider
    beepVolumeSlider.addEventListener('input', () => {
      const val = beepVolumeSlider.value;
      volumeValBadge.textContent = `${val}%`;
    });
    beepVolumeSlider.addEventListener('change', async () => {
      await saveSetting('beepVolume', beepVolumeSlider.value / 100);
    });

    // Pitch Slider
    beepPitchSlider.addEventListener('input', () => {
      const val = beepPitchSlider.value;
      pitchValBadge.textContent = `${val} Hz`;
    });
    beepPitchSlider.addEventListener('change', async () => {
      await saveSetting('beepPitch', Number(beepPitchSlider.value));
    });

    // Test Beep Button
    testBeepBtn.addEventListener('click', () => {
      playTestBeepTone();
    });

    // Mask Subtitles Toggle
    maskSubtitlesToggle.addEventListener('change', async () => {
      const enabled = maskSubtitlesToggle.checked;
      maskStyleContainer.style.display = enabled ? 'flex' : 'none';
      await saveSetting('maskSubtitles', enabled);
    });

    // Mask Style Select
    maskStyleSelect.addEventListener('change', async () => {
      await saveSetting('maskStyle', maskStyleSelect.value);
    });

    // Categories
    for (const [key, checkbox] of Object.entries(catCheckboxes)) {
      if (checkbox) {
        checkbox.addEventListener('change', async () => {
          const categories = { ...(currentSettings.categories || {}) };
          categories[key] = checkbox.checked;
          await saveSetting('categories', categories);
        });
      }
    }

    // Blacklist Add
    addBlacklistBtn.addEventListener('click', addBlacklistWord);
    blacklistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBlacklistWord();
    });

    // Whitelist Add
    addWhitelistBtn.addEventListener('click', addWhitelistWord);
    whitelistInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addWhitelistWord();
    });
  }

  async function saveSetting(key, value) {
    currentSettings[key] = value;
    await chrome.storage.local.set({ [key]: value });
  }

  function updateGlobalStatusUI(enabled) {
    if (enabled) {
      statusIndicator.classList.remove('disabled');
      globalStatusText.textContent = 'Active & Guarding';
    } else {
      statusIndicator.classList.add('disabled');
      globalStatusText.textContent = 'Censorship Paused';
    }
  }

  // Play test audio beep in popup
  function playTestBeepTone() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!audioContext) {
        audioContext = new AudioCtx();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const pitch = Number(beepPitchSlider.value) || 1000;
      const volume = (Number(beepVolumeSlider.value) || 80) / 100;
      const duration = 0.35;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume), now + 0.008);
      gain.gain.setValueAtTime(Math.max(0.01, volume), now + duration - 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (err) {
      console.warn('Could not play test tone:', err);
    }
  }

  // Blacklist Management
  async function addBlacklistWord() {
    const word = blacklistInput.value.trim().toLowerCase();
    if (!word) return;

    const list = currentSettings.customBlacklist || [];
    if (!list.includes(word)) {
      list.push(word);
      await saveSetting('customBlacklist', list);
      renderTags(blacklistTags, list, removeBlacklistTag);
    }
    blacklistInput.value = '';
  }

  async function removeBlacklistTag(word) {
    const list = (currentSettings.customBlacklist || []).filter(w => w !== word);
    await saveSetting('customBlacklist', list);
    renderTags(blacklistTags, list, removeBlacklistTag);
  }

  // Whitelist Management
  async function addWhitelistWord() {
    const word = whitelistInput.value.trim().toLowerCase();
    if (!word) return;

    const list = currentSettings.customWhitelist || [];
    if (!list.includes(word)) {
      list.push(word);
      await saveSetting('customWhitelist', list);
      renderTags(whitelistTags, list, removeWhitelistTag);
    }
    whitelistInput.value = '';
  }

  async function removeWhitelistTag(word) {
    const list = (currentSettings.customWhitelist || []).filter(w => w !== word);
    await saveSetting('customWhitelist', list);
    renderTags(whitelistTags, list, removeWhitelistTag);
  }

  function renderTags(container, items, onRemove) {
    container.innerHTML = '';
    if (items.length === 0) {
      const empty = document.createElement('span');
      empty.style.color = '#64748b';
      empty.style.fontSize = '11px';
      empty.textContent = 'None added yet';
      container.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = item;

      const removeBtn = document.createElement('span');
      removeBtn.className = 'tag-remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => onRemove(item));

      tag.appendChild(removeBtn);
      container.appendChild(tag);
    });
  }

  // Diagnostic query to active tab
  async function queryActiveTabStatus() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATUS' }).catch(() => null);

      if (!response) {
        statVideoEl.textContent = 'No Video';
        statVideoEl.className = 'status-pill inactive';
        statCaptionsEl.textContent = 'N/A';
        statCaptionsEl.className = 'status-pill';
        return;
      }

      if (response.videoCount > 0) {
        statVideoEl.textContent = `${response.videoCount} Found`;
        statVideoEl.className = 'status-pill active';
      } else {
        statVideoEl.textContent = 'None Found';
        statVideoEl.className = 'status-pill inactive';
      }

      if (response.hasCaptions) {
        statCaptionsEl.textContent = 'Active & Ready';
        statCaptionsEl.className = 'status-pill active';
      } else {
        statCaptionsEl.textContent = 'Turn CC on';
        statCaptionsEl.className = 'status-pill inactive';
      }

      if (response.isYouTube) {
        statPlatformEl.textContent = 'YouTube';
      } else {
        statPlatformEl.textContent = 'Web Video';
      }

      tabBleepCountEl.textContent = String(response.tabBleepCount || 0);
    } catch (e) {
      console.warn('Could not fetch active tab status:', e);
    }
  }
})();
