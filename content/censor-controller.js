// Central Censor Controller
// Coordinates video monitoring, precise timestamp triggers, audio synthesis, and stats.

(function () {
  'use strict';

  class CensorController {
    constructor() {
      this.enabled = true;
      this.filter = new window.BleeprProfanityFilter();
      this.audio = new window.BleeprAudioSynthesizer();
      this.interpolator = new window.BleeprTimeInterpolator();
      this.masker = new window.BleeprSubtitleMasker(this.filter);

      this.videoStates = new Map(); // video -> { scheduledWindows: [], animFrameId: null, tabBleepCount: 0 }
      this.tabBleepCount = 0;
      this.processedCueIds = new WeakSet();

      this.initSettingsListener();
    }

    async initSettingsListener() {
      // Load current settings from storage
      try {
        const settings = await chrome.storage.local.get(null);
        this.updateConfig(settings);
      } catch (err) {
        console.warn('[Bleepr] Could not read storage:', err);
      }

      // Listen for dynamic updates from popup or background
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
          const updated = {};
          for (const [key, change] of Object.entries(changes)) {
            updated[key] = change.newValue;
          }
          this.updateConfig(updated);
        }
      });
    }

    updateConfig(config) {
      if (typeof config.enabled === 'boolean') {
        this.enabled = config.enabled;
        if (!this.enabled) {
          this.audio.restoreAll();
        }
      }

      this.filter.updateConfig(config);
      this.audio.updateConfig(config);
      this.masker.updateConfig(config);
      if (typeof config.timingPaddingMs === 'number') {
        this.interpolator.setPadding(config.timingPaddingMs);
      }

      // Reprocess all cues if filter updated
      this.reprocessAllCues();
    }

    registerVideo(video) {
      if (this.videoStates.has(video)) return;

      const state = {
        scheduledWindows: [],
        animFrameId: null,
        isPlaying: !video.paused
      };
      this.videoStates.set(video, state);

      // Playback events
      video.addEventListener('play', () => {
        state.isPlaying = true;
        this.audio.ensureContextRunning();
        this.startPreciseLoop(video, state);
      });

      video.addEventListener('pause', () => {
        state.isPlaying = false;
        if (state.animFrameId) {
          cancelAnimationFrame(state.animFrameId);
          state.animFrameId = null;
        }
        this.audio.restoreVideoAudio(video);
      });

      video.addEventListener('seeking', () => {
        // Reset triggered flags for windows in the future
        const now = video.currentTime;
        for (const win of state.scheduledWindows) {
          if (win.startTime > now) {
            win.triggered = false;
          }
        }
      });

      // Start loop if already playing
      if (!video.paused) {
        this.startPreciseLoop(video, state);
      }
    }

    startPreciseLoop(video, state) {
      if (state.animFrameId) return;

      const checkPlayback = () => {
        if (!state.isPlaying || !this.enabled) {
          state.animFrameId = null;
          return;
        }

        const currentTime = video.currentTime;
        const windows = state.scheduledWindows;

        for (let i = 0; i < windows.length; i++) {
          const win = windows[i];

          // Check if video currentTime entered censor window
          if (!win.triggered && currentTime >= win.startTime && currentTime <= win.endTime + 0.1) {
            win.triggered = true;
            this.executeBleep(video, win.durationMs, win.word);
          }
        }

        state.animFrameId = requestAnimationFrame(checkPlayback);
      };

      state.animFrameId = requestAnimationFrame(checkPlayback);
    }

    /**
     * Executes the audio mute and beep action, and broadcasts statistics
     */
    executeBleep(video, durationMs, word) {
      if (!this.enabled) return;

      this.tabBleepCount++;
      console.log(`[Bleepr] 🔇 Censoring: "${word}" (${durationMs}ms) at ${video.currentTime.toFixed(2)}s`);

      this.audio.censor(video, durationMs, word);
      this.showBleepToast(video, word);

      // Notify background service worker
      try {
        chrome.runtime.sendMessage({
          type: 'BLEEP_OCCURRED',
          tabCount: this.tabBleepCount,
          word
        }).catch(() => {});
      } catch (e) {}
    }

    /**
     * Instant bleep trigger (e.g. from YouTube live caption mutation)
     */
    triggerInstantBleep(video, durationMs, word) {
      if (!this.enabled) return;
      this.executeBleep(video, durationMs, word);
    }

    processTrackCues(video, cues) {
      const state = this.videoStates.get(video);
      if (!state) return;

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (this.processedCueIds.has(cue)) continue;
        this.processedCueIds.add(cue);

        const text = cue.text || '';
        const matches = this.filter.findMatches(text);

        if (matches.length > 0) {
          // Mask cue visually
          this.masker.maskCue(cue);

          // Interpolate exact word timings
          const windows = this.interpolator.calculateCensorWindows(
            cue.startTime,
            cue.endTime,
            text,
            matches
          );

          for (const win of windows) {
            win.triggered = false;
            state.scheduledWindows.push(win);
          }
        }
      }

      // Sort windows by startTime
      state.scheduledWindows.sort((a, b) => a.startTime - b.startTime);
    }

    handleActiveCues(video, activeCues) {
      const state = this.videoStates.get(video);
      if (!state) return;

      for (let i = 0; i < activeCues.length; i++) {
        const cue = activeCues[i];
        const text = cue.text || '';
        const matches = this.filter.findMatches(text);

        if (matches.length > 0) {
          this.masker.maskCue(cue);
          // If not already in scheduledWindows, schedule now
          const alreadyScheduled = state.scheduledWindows.some(
            w => Math.abs(w.startTime - cue.startTime) < 0.2
          );

          if (!alreadyScheduled) {
            const windows = this.interpolator.calculateCensorWindows(
              cue.startTime,
              cue.endTime,
              text,
              matches
            );
            windows.forEach(w => {
              w.triggered = false;
              state.scheduledWindows.push(w);
            });
            state.scheduledWindows.sort((a, b) => a.startTime - b.startTime);
          }
        }
      }
    }

    clearVideoCues(video) {
      const state = this.videoStates.get(video);
      if (state) {
        state.scheduledWindows = [];
      }
    }

    reprocessAllCues() {
      this.processedCueIds = new WeakSet();
      for (const [video, state] of this.videoStates.entries()) {
        state.scheduledWindows = [];
        if (video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            const track = video.textTracks[i];
            if (track.cues) {
              this.processTrackCues(video, track.cues);
            }
          }
        }
      }
    }

    showBleepToast(video, word) {
      // Create a subtle unobtrusive HUD toast near video corner
      try {
        const existing = document.getElementById('bleepr-hud-indicator');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'bleepr-hud-indicator';
        toast.innerHTML = `
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px #ef4444;"></span>
            <span style="font-weight:600;letter-spacing:0.5px;">BLEEPR</span>
            <span style="opacity:0.75;font-size:11px;">[Censored]</span>
          </div>
        `;
        Object.assign(toast.style, {
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: '2147483647',
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          color: '#ffffff',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '12px',
          padding: '6px 12px',
          borderRadius: '20px',
          boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          pointerEvents: 'none',
          transition: 'all 0.25s ease',
          opacity: '0',
          transform: 'translateY(-6px)'
        });

        document.body.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
          toast.style.opacity = '1';
          toast.style.transform = 'translateY(0)';
        });

        // Animate out
        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transform = 'translateY(-6px)';
          setTimeout(() => toast.remove(), 250);
        }, 1200);
      } catch (e) {}
    }
  }

  window.BleeprCensorController = CensorController;
})();
