import { describe, expect, it } from 'vitest';

import { errorText, texts } from './ro';

describe('texts', () => {
  it('has a Romanian message for API error codes', () => {
    expect(errorText('slot_taken')).toBe('Ora tocmai a fost ocupată, alege alta.');
    expect(errorText('network_error')).toContain('internet');
  });

  it('never uses the legacy cedilla diacritics (ş, ţ)', () => {
    const all = JSON.stringify(texts, (_key, value) =>
      typeof value === 'function' ? value('x', 'y') : value,
    );
    expect(all).not.toMatch(/[şţŞŢ]/);
  });
});
