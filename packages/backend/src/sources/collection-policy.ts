import { z } from "zod";
export const CollectionPolicySchema = z.object({ enabled: z.boolean(), since: z.string().datetime(), maxAgeHours: z.number().int().min(1).max(168),
  perRun: z.number().int().min(1).max(10), perHour: z.number().int().min(1).max(20), perDay: z.number().int().min(1).max(100),
  perSourceDay: z.number().int().min(1).max(20), sourceIds: z.array(z.string()).min(1).max(100) }).strict();
export type CollectionPolicy = z.infer<typeof CollectionPolicySchema>;
export const DEFAULT_COLLECTION_LIMITS = { maxAgeHours: 48, perRun: 2, perHour: 4, perDay: 10, perSourceDay: 3 } as const;
export const DEFAULT_UPDATE_MODEL_LIMITS = { perMinute: 20, perHour: 60, perDay: 200 } as const;
