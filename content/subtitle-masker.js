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
     * Sanitizes a VTTCue / TextTrackCue while preserving original text
     * @param {VTTCue|TextTrackCue} cue
     */
    maskCue(cue) {
      if (!cue || !cue.text) return;

      // Preserve true original text before any masking
      if (!cue.__bleeprOriginal) {
        cue.__bleeprOriginal = cue.text;
      }

      if (!this.enabled) return;

      const original = cue.__bleeprOriginal;
      if (this.filter.hasProfanity(original)) {
        cue.text = this.filter.maskText(original, this.maskStyle);
      }
    }

    /**
     * Sanitizes a DOM node or text container (e.g. YouTube caption segments)
     * @param {HTMLElement} element
     */
    maskElement(element) {
      if (!element) return;

      if (!element.__bleeprOriginal) {
        element.__bleeprOriginal = element.textContent || '';
      }

      if (!this.enabled) return;

      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      let textNode;
      while ((textNode = walker.nextNode())) {
        const val = textNode.nodeValue;
        if (val && this.filter.hasProfanity(val)) {
          textNode.nodeValue = this.filter.maskText(val, this.maskStyle);
        }
      }
    }
  }

  window.BleeprSubtitleMasker = SubtitleMasker;
})();
