// YouTube-specific Caption Adapter
// Hooks into YouTube player DOM captions (.ytp-caption-segment) and live ASR streaming.

(function () {
  'use strict';

  class YouTubeAdapter {
    constructor(censorController) {
      this.controller = censorController;
      this.isYouTube = window.location.hostname.includes('youtube.com');
      this.captionObserver = null;
      this.processedSegments = new WeakSet();
      this.recentTextTimestamps = new Map(); // text -> timestamp
      if (this.isYouTube) {
        this.init();
      }
    }

    init() {
      // Monitor for YouTube player and caption container
      this.waitForPlayer();
    }

    waitForPlayer() {
      const check = () => {
        const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        if (player) {
          this.attachToPlayer(player);
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
    }

    attachToPlayer(player) {
      // Find or observe caption container
      const setupCaptionObserver = () => {
        const captionContainer = player.querySelector('.ytp-caption-window-container') || player;

        if (this.captionObserver) {
          this.captionObserver.disconnect();
        }

        this.captionObserver = new MutationObserver((mutations) => {
          this.handleCaptionMutations(mutations);
        });

        this.captionObserver.observe(captionContainer, {
          childList: true,
          subtree: true,
          characterData: true
        });
      };

      setupCaptionObserver();

      // YouTube player might recreate caption window when toggled or video changes
      const playerObserver = new MutationObserver(() => {
        const newContainer = player.querySelector('.ytp-caption-window-container');
        if (newContainer && (!this.captionObserver || !newContainer.contains(this.lastObservedNode))) {
          setupCaptionObserver();
          this.lastObservedNode = newContainer;
        }
      });

      playerObserver.observe(player, { childList: true });
    }

    handleCaptionMutations(mutations) {
      const video = document.querySelector('video.video-stream') || document.querySelector('video');
      if (!video) return;

      const segments = document.querySelectorAll('.ytp-caption-segment');

      for (const segment of segments) {
        const text = segment.textContent || '';
        if (!text.trim()) continue;

        // Visual masking first
        this.controller.masker.maskElement(segment);

        // Check for profanity matches
        const matches = this.controller.filter.findMatches(text);
        if (matches.length === 0) continue;

        // Prevent repeated triggers for the exact same segment text at the same playback second
        const currentTime = Math.floor(video.currentTime);
        const segmentKey = `${currentTime}:${text.trim()}`;

        if (this.recentTextTimestamps.has(segmentKey)) {
          continue;
        }
        this.recentTextTimestamps.set(segmentKey, Date.now());

        // Cleanup old cache entries
        if (this.recentTextTimestamps.size > 100) {
          const now = Date.now();
          for (const [key, ts] of this.recentTextTimestamps.entries()) {
            if (now - ts > 10000) {
              this.recentTextTimestamps.delete(key);
            }
          }
        }

        // Live ASR / DOM segment trigger
        // When YouTube displays a segment in DOM, it is being spoken right now.
        // For multiple words in one segment, trigger appropriate bleep duration.
        const durationMs = Math.max(380, Math.min(800, matches.length * 400));
        const matchedWords = matches.map(m => m.word).join(', ');

        this.controller.triggerInstantBleep(video, durationMs, matchedWords);
      }
    }

    destroy() {
      if (this.captionObserver) {
        this.captionObserver.disconnect();
      }
    }
  }

  window.BleeprYouTubeAdapter = YouTubeAdapter;
})();
