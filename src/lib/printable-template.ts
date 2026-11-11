// Mallen exakt som den ska tryckas: kundens dolda lager borttagna. Flödes-
// grupperna i mallen räknar sedan om placeringen (borttagna lager lämnar
// inget hål) inne i template-snapshot. Används av kundvagn/tryck OCH
// mockuper, så att allt kunden ser bygger på samma underlag.
import { mutateActiveLayoutBlock } from "./freeform-layers";
import type { Orientation, Template } from "./template-schema";

export function buildPrintableTemplate(
  template: Template,
  productType: string | null | undefined,
  layoutId: string | null | undefined,
  orientation: Orientation,
  hiddenLayerIds: Record<string, true>,
): Template {
  if (Object.keys(hiddenLayerIds).length === 0) return template;
  return mutateActiveLayoutBlock(template, productType, layoutId, orientation, (ls) =>
    ls.filter((l) => !hiddenLayerIds[l.id]),
  );
}

/**
 * Produkter som delar en huvudmall (t.ex. Maratontavla → Lopptavla) läser
 * mallen från huvudprodukten men behåller sina egna Shopify-/Gelato-uppgifter.
 */
export function withTemplateAlias<C extends { shopify_handle: string; product_type: string }>(
  config: C,
  configs: C[],
  aliases: Record<string, string>,
): C {
  const masterHandle = aliases[config.shopify_handle];
  if (!masterHandle) return config;
  const master =
    configs.find((c) => c.shopify_handle === masterHandle && c.product_type === config.product_type) ??
    configs.find((c) => c.shopify_handle === masterHandle);
  const masterTemplate = (master as unknown as { template?: unknown } | undefined)?.template;
  if (!masterTemplate) return config;
  return { ...config, template: masterTemplate } as C;
}
