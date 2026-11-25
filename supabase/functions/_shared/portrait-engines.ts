// Motortest för personporträtt (kung, drottning, kungligt parporträtt m.fl.),
// 2026-11-25. ENDAST admin.
//
// Problemet med dagens kedja (cdingram + NB2-retusch): ansiktsbytesmodellen
// byter bara den inre ansiktsytan, så ansiktsform, näsa och käke kommer från
// MÅLNINGEN, och retuschen får inte ändra ansiktet. Alla kunder blir lika
// förlagan. Här målas personen om i ETT steg med kundens foto som identitet
// och målningen som scen/stil — med tre utbytbara modeller så att de kan
// jämföras på samma foton (admin-sidan /admin/portratt-test).
//
// Motorer (humanEngine i request-body, kräver admin-JWT):
//   "current"  — dagens produktionskedja, men utan prenumerant-gaten
//   "nbpro"    — google/nano-banana-pro, 2K   (~$0.15/bild)
//   "nb2"      — google/nano-banana-2, 2K     (~$0.101/bild)
//   "seedream" — bytedance/seedream-4.5, 2K   (~$0.04/bild)
// Priset gäller per färdig bild, så ett par kostar lika mycket som en person.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  NANO_BANANA_MODEL,
  NANO_BANANA_PRO_MODEL,
  SEEDREAM_MODEL,
  runNanoBanana,
  runSeedream,
  nearestNanoAspect,
  nearestSeedreamAspect,
  probeImageAspect,
  type ReplicateResult,
} from "./replicate.ts";

export const ADMIN_EMAILS = ["akram@arthena.se"];

/** Sant om anropet bär en inloggad admins JWT. Fel = inte admin. */
export async function isAdminRequest(req: Request): Promise<boolean> {
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return false;
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await sb.auth.getUser(jwt);
    return ADMIN_EMAILS.includes((data?.user?.email ?? "").toLowerCase());
  } catch {
    return false;
  }
}

export type PortraitTestEngine = "current" | "nbpro" | "nb2" | "seedream";
export type SinglePassEngine = Exclude<PortraitTestEngine, "current">;

export function parsePortraitTestEngine(v: unknown): PortraitTestEngine | null {
  return v === "current" || v === "nbpro" || v === "nb2" || v === "seedream" ? v : null;
}

/** Värdet som loggas i generations.provider. */
export const SINGLE_PASS_PROVIDER: Record<SinglePassEngine, string> = {
  nbpro: `${NANO_BANANA_PRO_MODEL} 2K (ett steg)`,
  nb2: `${NANO_BANANA_MODEL} 2K (ett steg)`,
  seedream: `${SEEDREAM_MODEL} 2K (ett steg)`,
};

const IDENTITY_RULES = [
  "- overall face shape and width, jawline and chin, cheekbones, forehead and hairline;",
  "- nose shape and size, eye shape, eye colour and eyelids, eyebrows, mouth and lips, ears;",
  "- apparent age, wrinkles, skin tone, freckles and moles;",
  "- facial hair exactly as in the photo (style, length, colour) - clean-shaven if the photo is clean-shaven;",
  "- hair exactly as in the photo (style, length, colour, texture) adapted naturally under any crown or headwear - bald if bald;",
  "- glasses, earrings and piercings ONLY if clearly visible in the photo, otherwise none.",
];

/** En person: bild #1 = målningen, bild #2 = kundens foto. */
export const IDENTITY_REPAINT_PROMPT = [
  "Image #1 is a finished portrait painting (the scene). Image #2 is a photograph of a real person (the identity).",
  "Task: repaint the person in image #1 so that they unmistakably ARE the person in image #2. A close friend must instantly recognise them.",
  "The painted face in image #1 is only a placeholder. Do NOT keep its face shape, nose, eyes, mouth, jawline, age or hair. Take ALL of these from image #2 instead:",
  ...IDENTITY_RULES,
  "Expression: a natural, flattering version of the expression in image #2 (keep a smile if they smile).",
  "Keep EVERYTHING ELSE from image #1 unchanged: crown or headwear, clothing and costume jewellery, pose, body, hands, props, background, lighting direction, colour palette, framing, crop and aspect ratio. Never zoom, crop, pan or re-centre.",
  "Paint the new face and hair in exactly the same painting style, brushwork and lighting as image #1, so the result is ONE coherent painting - never a pasted photo.",
  "Return one single image.",
].join("\n");

/** Flera personer: bild #1 = målningen, bild #2.. = fotona i slot-ordning.
 *  `positions` är mallens slot-positioner (t.ex. "left", "right"). */
export function identityRepaintGroupPrompt(positions: string[]): string {
  const n = positions.length;
  const mapping = positions.map(
    (p, i) => `- Image #${i + 2} is the photograph of the person who must become the person at the ${p} position in image #1.`,
  );
  return [
    `Image #1 is a finished portrait painting of ${n} people (the scene). Images #2 to #${n + 1} are photographs of ${n} different real people (the identities):`,
    ...mapping,
    `Task: repaint each of the ${n} people in image #1 so that each one unmistakably IS the person in their own photograph. Close friends must instantly recognise every one of them.`,
    "The painted faces in image #1 are only placeholders. For EACH person, do NOT keep the painted face shape, nose, eyes, mouth, jawline, age or hair. Take ALL of these from that person's own photograph instead:",
    ...IDENTITY_RULES,
    "Never mix the people: each person gets only the features, hair, age and skin tone of their own photograph.",
    "Expressions: a natural, flattering version of each person's expression in their photograph.",
    "Keep EVERYTHING ELSE from image #1 unchanged: each person's position and pose, crowns or headwear, clothing and costume jewellery, bodies, hands, props, background, lighting direction, colour palette, framing, crop and aspect ratio. Never zoom, crop, pan or re-centre.",
    "Paint the new faces and hair in exactly the same painting style, brushwork and lighting as image #1, so the result is ONE coherent painting - never pasted photos.",
    "Return one single image.",
  ].join("\n");
}

/** Identitetsomålning i ett steg. Formatet låses alltid till målningens
 *  (bild #1) — med flera inputbilder kan "match_input_image" annars följa
 *  kundens telefonfoto (se order #1325). Ett omförsök vid övergående fel. */
export async function runIdentityRepaint(params: {
  engine: SinglePassEngine;
  promptText: string;
  referenceImageUrl: string;
  photoUrls: string[];
}): Promise<ReplicateResult> {
  const refAspect = await probeImageAspect(params.referenceImageUrl);
  const imageUrls = [params.referenceImageUrl, ...params.photoUrls];
  const attempt = () =>
    params.engine === "seedream"
      ? runSeedream({
          promptText: params.promptText,
          imageUrls,
          aspectRatio: refAspect ? nearestSeedreamAspect(refAspect) : null,
          size: "2K",
        })
      : runNanoBanana({
          promptText: params.promptText,
          imageUrls,
          model: params.engine === "nbpro" ? NANO_BANANA_PRO_MODEL : NANO_BANANA_MODEL,
          resolution: "2K",
          aspectRatio: refAspect ? nearestNanoAspect(refAspect) : null,
        });

  console.log(
    `[portrait-engines] ${params.engine} photos=${params.photoUrls.length} ` +
      `referens ${refAspect ? refAspect.toFixed(3) : "okänd"}`,
  );
  let r = await attempt();
  if (!r.ok && r.retriable) {
    console.warn(`[portrait-engines] ${params.engine} misslyckades (${r.reason}) — ett nytt försök om 5 s`);
    await new Promise((res) => setTimeout(res, 5000));
    r = await attempt();
  }
  if (!r.ok) console.error(`[portrait-engines] ${params.engine} misslyckades: ${r.reason}`);
  return r;
}
