import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_UI_LANGUAGE,
  formatPreferencesForPrompt,
  getPreferredLanguageName,
  normalizeLanguageCode,
} from '../preferences.ts';

describe('language preferences prompt formatting', () => {
  it('includes the explicit session language in the prompt', () => {
    const prompt = formatPreferencesForPrompt({ languageCode: 'ja' });

    expect(prompt).toContain('- Preferred language: 日本語');
  });

  it('falls back unsupported language codes to Simplified Chinese', () => {
    expect(normalizeLanguageCode('not-a-real-locale')).toBe(DEFAULT_UI_LANGUAGE);
    expect(getPreferredLanguageName('not-a-real-locale')).toBe('简体中文');
  });
});
