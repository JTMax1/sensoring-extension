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
      // Find existing videos
      this.scanForVideos();

      // Observe DOM for dynamically added videos (SPA navigation, modals, iframes)
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

      // Register video with central controller
      this.controller.registerVideo(video);

      // Listen for text tracks
      const textTracks = video.textTracks;
      if (textTracks) {
        for (let i = 0; i < textTracks.length; i++) {
          this.attachToTrack(textTracks[i], video);
        }

        textTracks.addEventListener('addtrack', (e) => {
          this.attachToTrack(e.track, video);
        });
      }

      // Clean up when video removed
      video.addEventListener('emptied', () => {
        // Video source changed
        this.controller.clearVideoCues(video);
      });
    }

    attachToTrack(track, video) {
      if (this.trackedTracks.has(track)) return;
      this.trackedTracks.add(track);

      // If track mode is disabled, we set it to 'hidden' so cues still load without forcing default browser rendering
      if (track.mode === 'disabled') {
        track.mode = 'hidden';
      }

      const processCues = () => {
        if (!track.cues || track.cues.length === 0) return;
        this.controller.processTrackCues(video, track.cues);
      };

      // Process existing cues
      processCues();

      // Listen for cue changes as track streams in
      track.addEventListener('cuechange', () => {
        processCues();
        // Also check currently active cues immediately
        if (track.activeCues && track.activeCues.length > 0) {
          this.controller.handleActiveCues(video, track.activeCues);
        }
      });
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
