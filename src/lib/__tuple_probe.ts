import { z } from "zod";

const t4 = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .transform(([lng, lat]) => [lng, lat] as [number, number]);
type T4 = z.output<typeof t4>;
const probe4: [number, number] = null as unknown as T4;

const t5 = z.custom<[number, number]>();
type T5 = z.output<typeof t5>;
const probe5: [number, number] = null as unknown as T5;

export const __probe = [probe4, probe5];
