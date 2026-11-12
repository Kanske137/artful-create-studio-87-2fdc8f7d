import { z } from "zod";

const t = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
type T = z.output<typeof t>;
const probe: [number, number] = null as unknown as T;

const t2 = z
  .tuple([z.number(), z.number()])
  .refine(([lng, lat]) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90);
type T2 = z.output<typeof t2>;
const probe2: [number, number] = null as unknown as T2;

const t3 = z.tuple([z.number(), z.number()]);
type T3 = z.output<typeof t3>;
const probe3: [number, number] = null as unknown as T3;

export const __probe = [probe, probe2, probe3];
