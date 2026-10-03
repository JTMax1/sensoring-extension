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

      this.videoStates = new Map(); // video -> { scheduledWindows: [], animFrameId: null, lastTime: 0, isPlaying: boolean }
      this.tabBleepCount = 0;
      this.processedCueIds = new WeakSet();

      this.initSettingsListener();
    }

    async initSettingsListener() {
      try {
        const settings = await chrome.storage.local.get(null);
        this.updateConfig(settings);
      } catch (err) {
        console.warn('[Bleepr] Could not read storage:', err);
      }

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

      this.reprocessAllCues();
    }

    registerVideo(video) {
      if (this.videoStates.has(video)) return;

      const state = {
        scheduledWindows: [],
        animFrameId: null,
        lastTime: video.currentTime || 0,
        isPlaying: !video.paused
      };
      this.videoStates.set(video, state);

      const rearmWindowsFromCurrentTime = () => {
        const now = video.currentTime;
        // Restore audio if mid-bleep when seeking
        this.audio.restoreVideoAudio(video);

        for (let i = 0; i < state.scheduledWindows.length; i++) {
          const win = state.scheduledWindows[i];
          // If window ends in the future or user sought right into it, re-arm
          if (win.endTime >= now - 0.3) {
            win.triggered = false;
          }
        }
        state.lastTime = now;
      };

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

      video.addEventListener('seeking', rearmWindowsFromCurrentTime);
      video.addEventListener('seeked', rearmWindowsFromCurrentTime);

      video.addEventListener('timeupdate', () => {
        const now = video.currentTime;
        // Detect backwards jumps (e.g. YouTube 'J' key, left arrow, or scrubber click)
        if (now < state.lastTime - 0.35) {
          rearmWindowsFromCurrentTime();
        }
        state.lastTime = now;
      });

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

          // Re-arm if the playhead is before this window
          if (currentTime < win.startTime - 0.4) {
            win.triggered = false;
          }

          // Check if video currentTime is inside censor window
          if (!win.triggered && currentTime >= win.startTime && currentTime <= win.endTime + 0.1) {
            win.triggered = true;
            this.executeBleep(video, win.durationMs, win.word);
          }
        }

        state.animFrameId = requestAnimationFrame(checkPlayback);
      };

      state.animFrameId = requestAnimationFrame(checkPlayback);
    }

    executeBleep(video, durationMs, word) {
      if (!this.enabled) return;

      this.tabBleepCount++;
      console.log(`[Bleepr] 🔇 Censoring: "${word}" (${durationMs}ms) at ${video.currentTime.toFixed(2)}s`);

      this.audio.censor(video, durationMs, word);
      this.showBleepToast(video, word);

      try {
        chrome.runtime.sendMessage({
          type: 'BLEEP_OCCURRED',
          tabCount: this.tabBleepCount,
          word
        }).catch(() => {});
      } catch (e) {}
    }

    triggerInstantBleep(video, durationMs, word) {
      if (!this.enabled) return;
      this.executeBleep(video, durationMs, word);
    }

    addScheduledWindow(video, win) {
      let state = this.videoStates.get(video);
      if (!state) {
        this.registerVideo(video);
        state = this.videoStates.get(video);
      }

      // Avoid exact duplicates
      const exists = state.scheduledWindows.some(
        w => Math.abs(w.startTime - win.startTime) < 0.2
      );

      if (!exists) {
        state.scheduledWindows.push({
          word: win.word,
          startTime: win.startTime,
          endTime: win.endTime,
          durationMs: win.durationMs,
          triggered: false
        });
        state.scheduledWindows.sort((a, b) => a.startTime - b.startTime);
      }
    }

    processTrackCues(video, cues) {
      const state = this.videoStates.get(video);
      if (!state) return;

      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        if (this.processedCueIds.has(cue)) continue;
        this.processedCueIds.add(cue);

        // Always use original text if cue was masked earlier
        const text = cue.__bleeprOriginal || cue.text || '';
        const matches = this.filter.findMatches(text);

        if (matches.length > 0) {
          // Visually mask cue
          this.masker.maskCue(cue);

          // Calculate precise word offset windows
          const windows = this.interpolator.calculateCensorWindows(
            cue.startTime,
            cue.endTime,
            text,
            matches
          );

          for (const win of windows) {
            this.addScheduledWindow(video, win);
          }
        }
      }
    }

    handleActiveCues(video, activeCues) {
      const state = this.videoStates.get(video);
      if (!state) return;

      for (let i = 0; i < activeCues.length; i++) {
        const cue = activeCues[i];
        const text = cue.__bleeprOriginal || cue.text || '';
        const matches = this.filter.findMatches(text);

        if (matches.length > 0) {
          this.masker.maskCue(cue);

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
            windows.forEach(w => this.addScheduledWindow(video, w));
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
          background: 'rgba(15, 23, 42, 0.9)',
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

        requestAnimationFrame(() => {
          toast.style.opacity = '1';
          toast.style.transform = 'translateY(0)';
        });

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
