// Time Interpolator for Subtitle Cues
// Solves the "whole sentence muted" problem by calculating exact word-level time offsets
// within a multi-second subtitle cue.

(function () {
  'use strict';

  class TimeInterpolator {
    constructor(paddingMs = 60, minDurationMs = 400) {
      this.paddingSec = paddingMs / 1000;
      this.minDurationSec = minDurationMs / 1000;
    }

    setPadding(paddingMs) {
      this.paddingSec = Math.max(0, paddingMs / 1000);
    }

    /**
     * Calculates time windows for all profanity matches within a subtitle cue.
     * @param {number} cueStart - Subtitle cue start time in seconds
     * @param {number} cueEnd - Subtitle cue end time in seconds
     * @param {string} fullText - Entire cue text
     * @param {Array<{word: string, index: number, length: number}>} matches - Matches from ProfanityFilter
     * @returns {Array<{word: string, startTime: number, endTime: number, durationMs: number}>}
     */
    calculateCensorWindows(cueStart, cueEnd, fullText, matches) {
      if (!matches || matches.length === 0 || cueEnd <= cueStart) return [];

      const cueDuration = cueEnd - cueStart;
      const cleanText = fullText.trim();
      const totalChars = cleanText.length;

      if (totalChars === 0) return [];

      // If the entire cue is very short (<= 0.7s), bleep the whole cue duration
      if (cueDuration <= 0.7) {
        return [{
          word: matches[0].word,
          startTime: cueStart,
          endTime: cueEnd,
          durationMs: Math.round(cueDuration * 1000)
        }];
      }

      const windows = [];

      for (const match of matches) {
        // Character-ratio based interpolation
        const startRatio = match.index / totalChars;
        const endRatio = (match.index + match.length) / totalChars;

        let wordStart = cueStart + (startRatio * cueDuration) - this.paddingSec;
        let wordEnd = cueStart + (endRatio * cueDuration) + this.paddingSec;

        // Ensure minimum duration for audibility and comfortable coverage
        const duration = wordEnd - wordStart;
        if (duration < this.minDurationSec) {
          const diff = this.minDurationSec - duration;
          wordStart = Math.max(cueStart, wordStart - diff / 2);
          wordEnd = Math.min(cueEnd, wordEnd + diff / 2);
        }

        // Clamp to cue bounds with small padding leeway
        wordStart = Math.max(cueStart - 0.05, wordStart);
        wordEnd = Math.min(cueEnd + 0.05, wordEnd);

        const durationMs = Math.round((wordEnd - wordStart) * 1000);

        windows.push({
          word: match.word,
          startTime: wordStart,
          endTime: wordEnd,
          durationMs: Math.max(250, durationMs)
        });
      }

      // Merge overlapping windows if any profanities appear back-to-back
      return this.mergeOverlapping(windows);
    }

    mergeOverlapping(windows) {
      if (windows.length <= 1) return windows;

      windows.sort((a, b) => a.startTime - b.startTime);
      const merged = [windows[0]];

      for (let i = 1; i < windows.length; i++) {
        const current = windows[i];
        const last = merged[merged.length - 1];

        if (current.startTime <= last.endTime + 0.1) {
          // Overlap or immediate neighbor
          last.endTime = Math.max(last.endTime, current.endTime);
          last.word += ` + ${current.word}`;
          last.durationMs = Math.round((last.endTime - last.startTime) * 1000);
        } else {
          merged.push(current);
        }
      }

      return merged;
    }
  }

  window.BleeprTimeInterpolator = TimeInterpolator;
})();
