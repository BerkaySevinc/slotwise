import { z } from 'zod';
import { parseWith, type ParseResult } from '@slotwise/shared';

/** ADR-0002: the locks of one appointment (duration plus buffer on a 5 minute grid) fit one transaction. */
export const MAX_DURATION_PLUS_BUFFER_MINUTES = 480;
export const DURATION_PLUS_BUFFER_ISSUE = 'duration_plus_buffer_too_long';
/** A `BatchGetItem` reads at most 100 keys; the limit leaves room. */
export const MAX_STAFF_PER_SERVICE = 50;

const name = z.string().trim().min(1).max(80);
const durationMinutes = z.number().int().min(5).max(480).multipleOf(5);
const bufferMinutes = z.number().int().min(0).max(60).multipleOf(5);
const priceMinor = z.number().int().min(0).max(100_000_000);
// Any short text: whether an id names a staff member of the tenant is checked against the table, so
// a malformed id and an unknown id give the same answer (`unknown_staff`).
const staffIds = z
  .array(z.string().min(1).max(64))
  .max(MAX_STAFF_PER_SERVICE)
  .refine((ids) => new Set(ids).size === ids.length, { error: 'duplicate_ids' });

export const createServiceSchema = z
  .strictObject({
    name,
    durationMinutes,
    bufferMinutes: bufferMinutes.default(0),
    priceMinor,
    staffIds: staffIds.default([]),
  })
  .refine((s) => s.durationMinutes + s.bufferMinutes <= MAX_DURATION_PLUS_BUFFER_MINUTES, {
    path: ['bufferMinutes'],
    error: DURATION_PLUS_BUFFER_ISSUE,
  });

export const updateServiceSchema = z
  .strictObject({
    name: name.optional(),
    durationMinutes: durationMinutes.optional(),
    bufferMinutes: bufferMinutes.optional(),
    priceMinor: priceMinor.optional(),
    active: z.boolean().optional(),
    staffIds: staffIds.optional(),
  })
  .refine((changes) => Object.values(changes).some((v) => v !== undefined), { error: 'empty' });

export type CreateServiceRequest = z.output<typeof createServiceSchema>;
export type UpdateServiceRequest = z.output<typeof updateServiceSchema>;

export const parseCreateServiceRequest = (body: unknown): ParseResult<CreateServiceRequest> =>
  parseWith(createServiceSchema, body);

export const parseUpdateServiceRequest = (body: unknown): ParseResult<UpdateServiceRequest> =>
  parseWith(updateServiceSchema, body);
