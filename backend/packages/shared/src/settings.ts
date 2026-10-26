export interface TenantSettings {
  slotGranularityMinutes: number;
  minLeadTimeMinutes: number;
  bookingWindowDays: number;
  cancellationCutoffMinutes: number;
  /** ISO 4217 code. Settings written before US-03 have none and are read as TRY. */
  currency: string;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  slotGranularityMinutes: 15,
  minLeadTimeMinutes: 2 * 60,
  bookingWindowDays: 60,
  cancellationCutoffMinutes: 24 * 60,
  currency: 'TRY',
};
