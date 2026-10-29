import { z } from 'zod';
import { parseWith, type ParseResult } from '@slotwise/shared';

const name = z.string().trim().min(1).max(80);

// A staff member has only a name and a flag: no contact data is stored (rule 7, US-04).
export const createStaffSchema = z.strictObject({ name });

export const updateStaffSchema = z
  .strictObject({
    name: name.optional(),
    active: z.boolean().optional(),
  })
  .refine((changes) => Object.values(changes).some((v) => v !== undefined), { error: 'empty' });

export type CreateStaffRequest = z.output<typeof createStaffSchema>;
export type UpdateStaffRequest = z.output<typeof updateStaffSchema>;

export const parseCreateStaffRequest = (body: unknown): ParseResult<CreateStaffRequest> =>
  parseWith(createStaffSchema, body);

export const parseUpdateStaffRequest = (body: unknown): ParseResult<UpdateStaffRequest> =>
  parseWith(updateStaffSchema, body);
