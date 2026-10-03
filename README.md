# 🔇 Bleepr - Real-time Video Subtitle Profanity Censor & Bleeper

**Bleepr** is a browser extension (Manifest V3) that monitors video playback subtitles and closed captions in real-time, detects targeted profanities (such as the f-word, slurs, or custom banned words), mutes the video audio at the exact word timestamp, and synthesizes a TV censor beep tone.

---

## ✨ Features

- **Sub-Second Word Timing Interpolation**: Avoids muting the entire 3–5 second sentence cue by estimating exact word positions based on character offsets and syllables, muting only the targeted profanity (~400ms–600ms).
- **Zero-Latency Broadcast Censor Tone**: Uses the Web Audio API (`AudioContext` + `OscillatorNode`) to synthesize an authentic 1000Hz sine wave censor tone with anti-click audio ramps.
- **3 Censor Action Modes**:
  - **Beep + Mute**: Mutes original audio and plays a 1 kHz TV censor tone.
  - **Silent Mute**: Mutes video audio cleanly without any jarring beep tone (ideal for kids or night watching).
  - **Audio Ducking**: Dips video volume to 10% instead of total silence, paired with a soft tone.
- **Visual Subtitle Masking**: Sanitizes rendered subtitles on-screen in real time so words are replaced with asterisks (`f***`) or tags (`[beep]`).
- **Comprehensive Profanity Filtering**:
  - Categorized presets: Strong Profanity (F-words, C-words), Moderate (S-words, vulgarities), Slurs, Sexual Anatomy, Mild (Damn, Hell).
  - Safe-word protection (protects words like *assassin*, *class*, *pass*, *cocktail*, *dickens* from false positives).
  - Custom Blacklist (add any trigger words, spoilers, or custom terms).
  - Custom Whitelist (specify words that must never be censored).
- **Universal HTML5 & YouTube Support**:
  - Standard HTML5 `<video>` text tracks (`VTTCue` / `TextTrackCue`).
  - YouTube player adapter observing `.ytp-caption-segment` and live ASR captions.
- **Interactive Popup Dashboard**:
  - Live sound tester with pitch (400Hz–1600Hz) and volume slider.
  - Active page diagnostics (checks if video and captions are detected in current tab).
  - Per-tab and all-time bleep statistics counter.

---

## 🚀 How to Install & Load in Chrome / Brave / Edge

1. Open your browser and navigate to:
   ```
   chrome://extensions/
   ```
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select this directory:
   ```
   /Users/bigchris/Documents/MiraClues/sensoring-extension
   ```
5. The **Bleepr** icon will appear in your browser toolbar. Pin it for quick access!

---

## 🧪 Testing the Extension

We have included a dedicated interactive test harness with simulated dialogue and subtitles.

1. Open [test/test-player.html](test/test-player.html) in your browser.
2. Click **Start Demo Video** or jump directly to test timestamps (*0:05* for the f-word, *0:14* for *motherfucker*).
3. Observe how:
   - The video background sound is momentarily muted during the profanity.
   - The 1000Hz censor beep plays right on time.
   - The subtitle text renders as `f***` instead of the explicit word.
   - Whitelisted words like *"assassin master class"* remain completely audible!
4. Open the extension popup from the toolbar to adjust volume, test the beep, toggle silent mute, or add custom words.
