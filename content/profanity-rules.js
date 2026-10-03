// Profanity Dictionary & Detection Engine
// Provides curated categorized vocabulary, regex pattern compilation, and masking utilities.

(function () {
  'use strict';

  // Core word categories (base patterns and common inflections)
  const RAW_DICTIONARIES = {
    strong: [
      // F-word and variants
      'fuck', 'fucker', 'fucking', 'fucked', 'fuckin', 'fucks', 'fuckup', 'motherfucker',
      'motherfucking', 'clusterfuck', 'fuckhead', 'fuckface', 'fuckwit',
      // C-word
      'cunt', 'cunts',
      // Explicit anatomical/sexual combinations
      'cocksucker', 'cocksucking', 'dipshit'
    ],
    moderate: [
      // S-word and variants
      'shit', 'shits', 'shitty', 'shitting', 'bullshit', 'horseshit', 'shithole', 'shithead',
      // B-word
      'bitch', 'bitches', 'bitching', 'bitchy', 'son of a bitch',
      // A-word
      'asshole', 'assholes', 'badass', 'dumbass', 'jackass', 'smartass',
      // Others
      'bastard', 'bastards', 'dickhead'
    ],
    mild: [
      'damn', 'dammit', 'damned', 'hell', 'crap', 'piss', 'pissed', 'pissing'
    ],
    slurs: [
      'nigger', 'nigga', 'faggot', 'fag', 'dyke', 'kike', 'spic', 'chink', 'retard', 'retarded', 'tranny'
    ],
    sexual: [
      'cock', 'cocks', 'dick', 'dicks', 'pussy', 'pussies', 'whore', 'slut', 'blowjob', 'handjob', 'twat'
    ]
  };

  // Known safe words that contain profanity substrings (avoid false positives)
  const DEFAULT_SAFE_WORDS = new Set([
    'bass', 'pass', 'class', 'grass', 'glass', 'mass', 'compass', 'embarrass', 'harass',
    'assume', 'assist', 'asset', 'association', 'cassette', 'passport',
    'cocktail', 'peacock', 'shuttlecock', 'woodcock', 'weathercock',
    'scunthorpe', 'penistone', 'canal', 'dickens', 'moby dick', 'spicy', 'dike'
  ]);

  class ProfanityFilter {
    constructor() {
      this.categories = {
        strong: true,
        moderate: true,
        mild: false,
        slurs: true,
        sexual: true
      };
      this.customBlacklist = [];
      this.customWhitelist = [];
      this.compiledRegex = null;
      this.cache = new Map();
    }

    updateConfig(config) {
      if (config.categories) {
        this.categories = { ...this.categories, ...config.categories };
      }
      if (Array.isArray(config.customBlacklist)) {
        this.customBlacklist = config.customBlacklist.map(w => w.trim().toLowerCase()).filter(Boolean);
      }
      if (Array.isArray(config.customWhitelist)) {
        this.customWhitelist = config.customWhitelist.map(w => w.trim().toLowerCase()).filter(Boolean);
      }
      this.compile();
    }

    compile() {
      const activeWords = new Set();

      // Add enabled category words
      for (const [cat, enabled] of Object.entries(this.categories)) {
        if (enabled && RAW_DICTIONARIES[cat]) {
          RAW_DICTIONARIES[cat].forEach(word => activeWords.add(word.toLowerCase()));
        }
      }

      // Add custom blacklist
      this.customBlacklist.forEach(word => activeWords.add(word.toLowerCase()));

      // Remove custom whitelist
      this.customWhitelist.forEach(word => activeWords.delete(word.toLowerCase()));

      if (activeWords.size === 0) {
        this.compiledRegex = null;
        this.cache.clear();
        return;
      }

      // Build regex pattern with leetspeak/symbol tolerance for vowels & characters
      // e.g. f[*]ck, f[u*@]ck
      const wordPatterns = Array.from(activeWords).map(word => {
        // Multi-word phrases like "son of a bitch"
        if (word.includes(' ')) {
          return word.split(/\s+/).map(p => this.escapeRegex(p)).join('\\s+');
        }

        // Single word: build fuzzy character matching
        return this.createFuzzyPattern(word);
      });

      // Match full words only using word boundaries
      // Note: punctuation boundaries also handled
      const combined = `\\b(?:${wordPatterns.join('|')})\\b`;
      this.compiledRegex = new RegExp(combined, 'gi');
      this.cache.clear();
    }

    createFuzzyPattern(word) {
      // If word already contains special characters, escape
      const charMap = {
        'a': '[a@*4]',
        'e': '[e3*]',
        'i': '[i!1*|]',
        'o': '[o0*]',
        'u': '[uv*]',
        's': '[s$5]',
        'c': '[c(]',
        't': '[t+7]'
      };

      const chars = word.split('').map(ch => {
        const lower = ch.toLowerCase();
        if (charMap[lower]) {
          return `${charMap[lower]}+`;
        }
        return `${this.escapeRegex(ch)}+`;
      });

      return chars.join('[\\W_]*'); // allow separator characters like f.u.c.k or f-u-c-k
    }

    escapeRegex(string) {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Checks if a word is in the whitelist or default safe words
     */
    isWhitelisted(word) {
      const lower = word.toLowerCase().trim();
      if (DEFAULT_SAFE_WORDS.has(lower)) return true;
      if (this.customWhitelist.includes(lower)) return true;
      return false;
    }

    /**
     * Finds all profanities in the given text with character offsets
     * @param {string} text - text to inspect
     * @returns {Array<{word: string, index: number, length: number}>}
     */
    findMatches(text) {
      if (!this.compiledRegex || !text) return [];

      const matches = [];
      let match;
      this.compiledRegex.lastIndex = 0;

      while ((match = this.compiledRegex.exec(text)) !== null) {
        const matchedWord = match[0];
        const index = match.index;

        if (!this.isWhitelisted(matchedWord)) {
          matches.push({
            word: matchedWord,
            index: index,
            length: matchedWord.length
          });
        }
      }

      return matches;
    }

    /**
     * Tests if text contains any forbidden words
     */
    hasProfanity(text) {
      if (!this.compiledRegex || !text) return false;
      const matches = this.findMatches(text);
      return matches.length > 0;
    }

    /**
     * Masks profanities in text
     * @param {string} text
     * @param {'asterisk'|'tag'} style
     */
    maskText(text, style = 'asterisk') {
      const matches = this.findMatches(text);
      if (matches.length === 0) return text;

      let result = '';
      let lastIndex = 0;

      for (const m of matches) {
        result += text.slice(lastIndex, m.index);
        if (style === 'tag') {
          result += '[bleep]';
        } else {
          // Keep first character, asterisk the rest: f*** or s***
          if (m.word.length <= 2) {
            result += '*'.repeat(m.word.length);
          } else {
            result += m.word[0] + '*'.repeat(m.word.length - 1);
          }
        }
        lastIndex = m.index + m.length;
      }
      result += text.slice(lastIndex);
      return result;
    }
  }

  // Export to window/global scope for content scripts
  window.BleeprProfanityFilter = ProfanityFilter;
})();
