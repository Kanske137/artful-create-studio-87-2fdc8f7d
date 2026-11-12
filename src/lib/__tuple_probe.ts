import { z } from "zod";

const t = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
type T = z.output<typeof t>;
const probe: [number, number] = null as unknown as T;

export const __probe = probe;
