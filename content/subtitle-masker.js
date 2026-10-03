// Subtitle Visual Masker
// Sanitizes on-screen captions so explicit words are masked (e.g. f*** or [beep])

(function () {
  'use strict';

  class SubtitleMasker {
    constructor(profanityFilter) {
      this.filter = profanityFilter;
      this.enabled = true;
      this.maskStyle = 'asterisk'; // 'asterisk' | 'tag'
    }

    updateConfig(config) {
      if (typeof config.maskSubtitles === 'boolean') {
        this.enabled = config.maskSubtitles;
      }
      if (config.maskStyle) {
        this.maskStyle = config.maskStyle;
      }
    }

    /**
     * Sanitizes a VTTCue / TextTrackCue
     * @param {VTTCue|TextTrackCue} cue
     */
    maskCue(cue) {
      if (!this.enabled || !cue || !cue.text) return;
      if (this.filter.hasProfanity(cue.text)) {
        cue.text = this.filter.maskText(cue.text, this.maskStyle);
      }
    }

    /**
     * Sanitizes a DOM node or text container (e.g. YouTube caption segments)
     * @param {HTMLElement} element
     */
    maskElement(element) {
      if (!this.enabled || !element) return;

      // Handle text content of element safely
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let textNode;
      while ((textNode = walker.nextNode())) {
        const original = textNode.nodeValue;
        if (original && this.filter.hasProfanity(original)) {
          textNode.nodeValue = this.filter.maskText(original, this.maskStyle);
        }
      }
    }
  }

  window.BleeprSubtitleMasker = SubtitleMasker;
})();
