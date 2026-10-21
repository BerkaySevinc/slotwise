import { expect, it } from 'vitest';
import { DEFAULT_TENANT_SETTINGS } from './settings.js';

it('matches the defaults in AC-01.9', () => {
  expect(DEFAULT_TENANT_SETTINGS).toEqual({
    slotGranularityMinutes: 15,
    minLeadTimeMinutes: 120,
    bookingWindowDays: 60,
    cancellationCutoffMinutes: 1440,
  });
});
