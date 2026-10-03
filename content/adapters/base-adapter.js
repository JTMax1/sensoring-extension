// Standard HTML5 Video & TextTrack Adapter
// Monitors native <video> elements, textTracks, and cue events.

(function () {
  'use strict';

  class BaseVideoAdapter {
    constructor(censorController) {
      this.controller = censorController;
      this.trackedVideos = new Set();
      this.trackedTracks = new Set();
      this.observer = null;
      this.init();
    }

    init() {
      this.scanForVideos();

      this.observer = new MutationObserver(() => {
        this.scanForVideos();
      });

      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    scanForVideos() {
      const videos = document.querySelectorAll('video');
      videos.forEach(video => this.attachToVideo(video));
    }

    attachToVideo(video) {
      if (this.trackedVideos.has(video)) return;
      this.trackedVideos.add(video);

      this.controller.registerVideo(video);

      // Check text tracks immediately and periodically as video loads
      this.checkTracks(video);

      const textTracks = video.textTracks;
      if (textTracks) {
        textTracks.addEventListener('addtrack', (e) => {
          this.attachToTrack(e.track, video);
        });
      }

      // Check for tracks on play/seek in case added dynamically
      video.addEventListener('play', () => this.checkTracks(video));
      video.addEventListener('seeking', () => this.checkTracks(video));
      video.addEventListener('seeked', () => this.checkTracks(video));

      video.addEventListener('emptied', () => {
        this.controller.clearVideoCues(video);
      });
    }

    checkTracks(video) {
      const textTracks = video.textTracks;
      if (!textTracks) return;

      for (let i = 0; i < textTracks.length; i++) {
        this.attachToTrack(textTracks[i], video);
      }
    }

    attachToTrack(track, video) {
      // If mode is disabled, activate it to 'hidden' so cues fire events without disturbing native styles
      if (track.mode === 'disabled') {
        track.mode = 'hidden';
      }

      const processCues = () => {
        if (!track.cues || track.cues.length === 0) return;
        this.controller.processTrackCues(video, track.cues);
      };

      processCues();

      if (!this.trackedTracks.has(track)) {
        this.trackedTracks.add(track);

        track.addEventListener('cuechange', () => {
          processCues();
          if (track.activeCues && track.activeCues.length > 0) {
            this.controller.handleActiveCues(video, track.activeCues);
          }
        });
      }
    }

    destroy() {
      if (this.observer) {
        this.observer.disconnect();
      }
      this.trackedVideos.clear();
      this.trackedTracks.clear();
    }
  }

  window.BleeprBaseVideoAdapter = BaseVideoAdapter;
})();
