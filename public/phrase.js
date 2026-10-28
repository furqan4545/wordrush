/** One input rule shared by the form, render API, and video timeline. */
export const MAX_WORDS = 8;

export function normalizePhrase(value = '') {
  return String(value).trim().replace(/^how\s+to(?:\s*[:,]\s*|\s+|$)/iu, '').trim();
}

export function parsePhrase(value, {stripPrefix = true} = {}) {
  if (typeof value !== 'string') return {phrase: '', wordCount: 0, error: 'Enter a word or phrase for your video.'};
  const phrase = stripPrefix ? normalizePhrase(value) : value.trim();
  const wordCount = phrase ? phrase.split(/\s+/u).length : 0;
  let error = '';
  if (/[\u0000-\u001f\u007f]/u.test(value)) error = 'Keep your phrase on one line.';
  else if (!phrase) error = 'Add a word or phrase after “How to:”, or enter your own phrase.';
  else if (wordCount > MAX_WORDS) error = `Use up to ${MAX_WORDS} words. You entered ${wordCount}.`;
  return {phrase, wordCount, error};
}
