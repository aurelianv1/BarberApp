import { describe, expect, it } from 'vitest';

import { texts } from './ro';

describe('texts', () => {
  it('exposes the app name', () => {
    expect(texts.common.appName.length).toBeGreaterThan(0);
  });
});
