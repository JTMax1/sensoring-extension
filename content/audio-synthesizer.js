// Audio Synthesizer & Video Mute Coordinator
// Generates low-latency broadcast-grade censor tones and synchronizes video volume dips.

(function () {
  'use strict';

  class AudioSynthesizer {
    constructor() {
      this.ctx = null;
      this.censorMode = 'beep_and_mute'; // 'beep_and_mute' | 'mute_only' | 'duck_and_beep'
      this.beepVolume = 0.8;
      this.beepPitch = 1000; // Hz
      this.duckVolume = 0.1;
      this.activeCensors = new Map(); // video -> { count: number, originalMuted: boolean, originalVolume: number, timer: timeout }
      this.initContext();
    }

    initContext() {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx && !this.ctx) {
          this.ctx = new AudioCtx();
        }
      } catch (err) {
        console.warn('[Bleepr] AudioContext initialization deferred:', err);
      }
    }

    async ensureContextRunning() {
      if (!this.ctx) {
        this.initContext();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        try {
          await this.ctx.resume();
        } catch (e) {
          // Will resume upon user gesture
        }
      }
    }

    updateConfig(config) {
      if (config.censorMode) this.censorMode = config.censorMode;
      if (typeof config.beepVolume === 'number') this.beepVolume = config.beepVolume;
      if (typeof config.beepPitch === 'number') this.beepPitch = config.beepPitch;
      if (typeof config.duckVolume === 'number') this.duckVolume = config.duckVolume;
    }

    /**
     * Executes censor action for a specified duration on a video element.
     * @param {HTMLMediaElement} video
     * @param {number} durationMs - Duration of the censor in milliseconds
     * @param {string} word - The censored word (for logging/debug)
     */
    async censor(video, durationMs, word = '') {
      if (!video) return;

      const durationSec = Math.max(0.2, durationMs / 1000);
      await this.ensureContextRunning();

      // Manage video audio attenuation
      this.suppressVideoAudio(video, durationMs);

      // Play beep if mode requires it
      if (this.censorMode === 'beep_and_mute' || this.censorMode === 'duck_and_beep') {
        const vol = this.censorMode === 'duck_and_beep' ? this.beepVolume * 0.6 : this.beepVolume;
        this.playTone(durationSec, vol);
      }
    }

    /**
     * Synthesizes a clean 1kHz sine wave with attack and decay ramps
     * @param {number} durationSec
     * @param {number} volume
     */
    playTone(durationSec, volume = 0.8) {
      if (!this.ctx || this.ctx.state !== 'running') {
        // Fallback: try to resume if suspended
        this.ensureContextRunning();
        if (!this.ctx) return;
      }

      try {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(this.beepPitch, this.ctx.currentTime);

        // Anti-click attack and decay envelope
        const now = this.ctx.currentTime;
        const rampTime = 0.008; // 8ms ramp prevents audio pops

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume), now + rampTime);
        gain.gain.setValueAtTime(Math.max(0.01, volume), now + durationSec - rampTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + durationSec + 0.01);
      } catch (err) {
        console.warn('[Bleepr] Could not play synthesized tone:', err);
      }
    }

    /**
     * Lowers or mutes video element volume with reference counting
     */
    suppressVideoAudio(video, durationMs) {
      let state = this.activeCensors.get(video);

      if (!state) {
        state = {
          count: 1,
          originalMuted: video.muted,
          originalVolume: video.volume,
          timer: null
        };
        this.activeCensors.set(video, state);

        if (this.censorMode === 'duck_and_beep') {
          video.volume = Math.min(video.volume, this.duckVolume);
        } else {
          // 'beep_and_mute' or 'mute_only'
          video.muted = true;
        }
      } else {
        state.count++;
        if (state.timer) {
          clearTimeout(state.timer);
        }
      }

      state.timer = setTimeout(() => {
        this.restoreVideoAudio(video);
      }, durationMs);
    }

    /**
     * Restores original video audio safely
     */
    restoreVideoAudio(video) {
      const state = this.activeCensors.get(video);
      if (!state) return;

      state.count--;
      if (state.count <= 0) {
        if (this.censorMode === 'duck_and_beep') {
          video.volume = state.originalVolume;
        } else {
          video.muted = state.originalMuted;
        }
        this.activeCensors.delete(video);
      }
    }

    /**
     * Force restore all currently muted videos (e.g. extension disabled or tab blur)
     */
    restoreAll() {
      for (const [video, state] of this.activeCensors.entries()) {
        if (state.timer) clearTimeout(state.timer);
        video.muted = state.originalMuted;
        video.volume = state.originalVolume;
      }
      this.activeCensors.clear();
    }
  }

  window.BleeprAudioSynthesizer = AudioSynthesizer;
})();
