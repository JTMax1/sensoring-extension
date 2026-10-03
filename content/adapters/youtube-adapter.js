// YouTube-specific Caption Adapter
// Hooks YouTube timedtext caption track for precise millisecond word bleeps
// and uses real-time DOM caption observation for live visual masking and fallback.

(function () {
  'use strict';

  class YouTubeAdapter {
    constructor(censorController) {
      this.controller = censorController;
      this.isYouTube = window.location.hostname.includes('youtube.com');
      this.captionObserver = null;
      this.currentVideoId = null;
      this.recentBleeps = new Map(); // word -> timestamp (short debounce only)

      if (this.isYouTube) {
        this.init();
      }
    }

    init() {
      this.waitForPlayerAndVideo();

      // Listen for YouTube Single Page App (SPA) video changes
      window.addEventListener('yt-navigate-finish', () => {
        this.onVideoChanged();
      });

      // Also listen to popstate for URL history back/forward
      window.addEventListener('popstate', () => {
        this.onVideoChanged();
      });
    }

    onVideoChanged() {
      this.recentBleeps.clear();
      setTimeout(() => {
        this.waitForPlayerAndVideo();
      }, 500);
    }

    waitForPlayerAndVideo() {
      const check = () => {
        const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
        const video = document.querySelector('video.video-stream') || document.querySelector('video');

        if (player && video) {
          this.attachToPlayer(player, video);
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
    }

    attachToPlayer(player, video) {
      // Register video with controller
      this.controller.registerVideo(video);

      // Reset bleep debounce on seek so rewinding always bleeps again!
      video.addEventListener('seeking', () => {
        this.recentBleeps.clear();
      });
      video.addEventListener('seeked', () => {
        this.recentBleeps.clear();
      });

      // Try to load pre-calculated timedtext captions for YouTube video
      this.loadYouTubeCaptionTracks(video);

      // Setup DOM mutation observer on captions container for live visual masking & fallback
      this.setupDOMCaptionObserver(player, video);
    }

    async loadYouTubeCaptionTracks(video) {
      const urlParams = new URLSearchParams(window.location.search);
      const videoId = urlParams.get('v');
      if (!videoId || videoId === this.currentVideoId) return;

      this.currentVideoId = videoId;
      console.log(`[Bleepr] Loading YouTube caption tracks for video: ${videoId}`);

      try {
        // Extract caption tracks from ytInitialPlayerResponse in DOM script tags
        const captionTracks = this.extractCaptionTracksFromDOM();

        if (captionTracks && captionTracks.length > 0) {
          // Find English or first available track
          const track = captionTracks.find(t => t.languageCode === 'en' || (t.vssId && t.vssId.includes('.en'))) || captionTracks[0];

          if (track && track.baseUrl) {
            await this.fetchAndParseTimedText(video, track.baseUrl);
          }
        }
      } catch (err) {
        console.warn('[Bleepr] TimedText extraction fallback to DOM observer:', err);
      }
    }

    extractCaptionTracksFromDOM() {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text && text.includes('captionTracks')) {
          const match = text.match(/"captionTracks":\s*(\[.*?\])/);
          if (match && match[1]) {
            try {
              return JSON.parse(match[1]);
            } catch (e) {}
          }
        }
      }
      return null;
    }

    async fetchAndParseTimedText(video, baseUrl) {
      // Append fmt=json3 for word-level millisecond offset segments
      const url = baseUrl.includes('fmt=') ? baseUrl : `${baseUrl}&fmt=json3`;

      try {
        const res = await fetch(url);
        if (!res.ok) return;

        const data = await res.json();
        if (!data || !data.events) return;

        console.log(`[Bleepr] Successfully parsed YouTube timedtext (${data.events.length} caption events)`);

        for (const event of data.events) {
          if (!event.segs || typeof event.tStartMs !== 'number') continue;

          const cueStartSec = event.tStartMs / 1000;
          const cueDurationSec = (event.dDurationMs || 3000) / 1000;
          const cueEndSec = cueStartSec + cueDurationSec;

          // Check each segment or the full cue text
          for (const seg of event.segs) {
            const segText = seg.utf8 || '';
            const matches = this.controller.filter.findMatches(segText);

            if (matches.length > 0) {
              const segOffsetSec = (seg.tOffsetMs || 0) / 1000;
              const wordStart = cueStartSec + segOffsetSec - 0.06;
              const wordDurationMs = Math.max(380, Math.min(800, (seg.dDurationMs || 450)));

              for (const m of matches) {
                this.controller.addScheduledWindow(video, {
                  word: m.word,
                  startTime: Math.max(0, wordStart),
                  endTime: wordStart + (wordDurationMs / 1000),
                  durationMs: wordDurationMs
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Bleepr] Could not fetch YouTube timedtext:', err);
      }
    }

    setupDOMCaptionObserver(player, video) {
      const setup = () => {
        const captionContainer = player.querySelector('.ytp-caption-window-container') || player;

        if (this.captionObserver) {
          this.captionObserver.disconnect();
        }

        this.captionObserver = new MutationObserver(() => {
          this.handleCaptionMutations(video);
        });

        this.captionObserver.observe(captionContainer, {
          childList: true,
          subtree: true,
          characterData: true
        });
      };

      setup();

      // Monitor player for caption container re-creations
      const playerObserver = new MutationObserver(() => {
        const newContainer = player.querySelector('.ytp-caption-window-container');
        if (newContainer && newContainer !== this.lastObservedNode) {
          setup();
          this.lastObservedNode = newContainer;
        }
      });
      playerObserver.observe(player, { childList: true });
    }

    handleCaptionMutations(video) {
      if (!video) return;

      const segments = document.querySelectorAll('.ytp-caption-segment');

      for (const segment of segments) {
        // Read text before masking
        const text = segment.__bleeprOriginal || segment.textContent || '';
        if (!text.trim()) continue;

        // Visual masking in DOM
        this.controller.masker.maskElement(segment);

        // Find matches
        const matches = this.controller.filter.findMatches(text);
        if (matches.length === 0) continue;

        // Short debounce (400ms) to prevent re-triggering during the same speech instance
        const now = Date.now();
        const firstWord = matches[0].word.toLowerCase();
        const lastBleepTime = this.recentBleeps.get(firstWord) || 0;

        if (now - lastBleepTime < 450) {
          continue;
        }
        this.recentBleeps.set(firstWord, now);

        // Live DOM trigger
        const durationMs = Math.max(380, Math.min(800, matches.length * 400));
        const words = matches.map(m => m.word).join(', ');

        this.controller.triggerInstantBleep(video, durationMs, words);
      }
    }

    destroy() {
      if (this.captionObserver) {
        this.captionObserver.disconnect();
      }
      this.recentBleeps.clear();
    }
  }

  window.BleeprYouTubeAdapter = YouTubeAdapter;
})();
