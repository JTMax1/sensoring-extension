// Bleepr Content Script Entry Point
// Bootstraps controller, adapters, and answers status queries from popup.

(function () {
  'use strict';

  if (window.__bleepr_initialized) return;
  window.__bleepr_initialized = true;

  console.log('[Bleepr] Initializing Video Profanity Censor & Bleeper...');

  const controller = new window.BleeprCensorController();
  const baseAdapter = new window.BleeprBaseVideoAdapter(controller);
  const youtubeAdapter = new window.BleeprYouTubeAdapter(controller);

  // Resume AudioContext on initial page interaction (browser autoplay policy requirement)
  const unlockAudio = () => {
    controller.audio.ensureContextRunning();
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('click', unlockAudio, { passive: true });
  window.addEventListener('keydown', unlockAudio, { passive: true });

  // Answer status requests from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PAGE_STATUS') {
      const videos = document.querySelectorAll('video');
      let hasCaptions = false;

      videos.forEach(v => {
        if (v.textTracks && v.textTracks.length > 0) {
          hasCaptions = true;
        }
      });

      // Check YouTube captions
      if (document.querySelector('.ytp-caption-segment') || document.querySelector('.ytp-subtitles-button[aria-pressed="true"]')) {
        hasCaptions = true;
      }

      sendResponse({
        active: controller.enabled,
        videoCount: videos.length,
        hasCaptions: hasCaptions,
        tabBleepCount: controller.tabBleepCount,
        isYouTube: window.location.hostname.includes('youtube.com')
      });
      return true;
    }

    if (message.type === 'PLAY_TEST_BEEP') {
      controller.audio.ensureContextRunning();
      controller.audio.playTone(0.4, controller.audio.beepVolume);
      sendResponse({ success: true });
      return true;
    }
  });

  window.__bleepr = {
    controller,
    baseAdapter,
    youtubeAdapter
  };
})();
