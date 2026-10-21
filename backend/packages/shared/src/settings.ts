export interface TenantSettings {
  slotGranularityMinutes: number;
  minLeadTimeMinutes: number;
  bookingWindowDays: number;
  cancellationCutoffMinutes: number;
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  slotGranularityMinutes: 15,
  minLeadTimeMinutes: 2 * 60,
  bookingWindowDays: 60,
  cancellationCutoffMinutes: 24 * 60,
};
