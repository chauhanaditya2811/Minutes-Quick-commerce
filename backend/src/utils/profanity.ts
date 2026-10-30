import { BLOCKED_ANYWHERE, BLOCKED_PREFIXES, BLOCKED_WORDS } from "./blockedWords.js";

// Symbols and digits people swap in for letters: "sh1t", "@ss", "b!tch".
const LOOKALIKES: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

/** "fuuuuck" → "fuck". Only used for longer words, so short ones like "ass" never match "as". */
const squash = (word: string) => word.replace(/(.)\1+/g, "$1");
const SQUASH_MIN = 5;

const exact = new Set(BLOCKED_WORDS);
const squashed = new Set(BLOCKED_WORDS.map(squash).filter((w) => w.length >= SQUASH_MIN));
const prefixes = BLOCKED_PREFIXES;
const anywhere = BLOCKED_ANYWHERE;

/**
 * Splits text into lowercase words the way a reader would see them:
 * - lookalike symbols become letters, but only inside words that already have a letter,
 *   so sizes like "455 g" stay numbers;
 * - runs of single letters are joined, so "f u c k" and "f.u.c.k" become "fuck".
 */
const toWords = (text: string) => {
  const raw = text
    .toLowerCase()
    .split(/[\s.,_\-*/\\|'"`~^+=:;?()[\]{}<>&#%]+/)
    .filter(Boolean)
    .map((token) => (/[a-z]/.test(token) ? token.replace(/[013457@$!]/g, (c) => LOOKALIKES[c] ?? c) : token))
    .map((token) => token.replace(/[^a-z]/g, ""))
    .filter(Boolean);

  const words: string[] = [];
  let letters = "";
  for (const token of raw) {
    if (token.length === 1) {
      letters += token;
      continue;
    }
    if (letters) words.push(letters);
    letters = "";
    words.push(token);
  }
  if (letters) words.push(letters);
  return words;
};

/** True when text contains abusive words in any of the blocked languages, however spelled. */
export const containsBlockedWords = (text: string) => {
  const words = toWords(text);
  const isBlocked = (word: string) =>
    exact.has(word) ||
    (word.length >= SQUASH_MIN && squashed.has(squash(word))) ||
    prefixes.some((prefix) => word.startsWith(prefix) || squash(word).startsWith(prefix));
  if (words.some(isBlocked)) return true;

  // Phrases and long words hidden inside other letters or split across words.
  const compact = words.join("");
  return anywhere.some((term) => compact.includes(term) || squash(compact).includes(squash(term)));
};
