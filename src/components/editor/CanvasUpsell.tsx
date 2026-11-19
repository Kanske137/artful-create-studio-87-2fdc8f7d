import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShopContextStore } from "@/stores/shopContextStore";
import { getShopifyPrices, type ShopifyMoney } from "@/lib/shopify-prices";
import { formatMoneyDelta } from "@/lib/format-price";

interface Props {
  /** Shopify-handle för canvas-konfigurationen i samma mall. */
  canvasHandle: string;
  /** Vald storlek, t.ex. "30x40". */
  size: string;
  /** Canvasdjupet att jämföra med (första tillgängliga, oftast "2cm"). */
  canvasDepth: string;
  /** Livepriset för den valda postern (kundens valuta), om det finns. */
  posterLive: ShopifyMoney | null;
  /** Reservberäkning i kundens valuta när livepris saknas. */
  fallbackDelta: string | null;
  onSwitch: () => void;
}

/**
 * Visar "Canvas för +X mer" under Poster/Canvas-valet när kunden har en
 * poster vald och samma storlek finns som canvas (beslut 19 nov 2026: lyft
 * canvas som uppgradering; canvasordrar ligger i snitt på 529 kr mot 212 kr
 * för en poster utan ram).
 */
export function CanvasUpsell({ canvasHandle, size, canvasDepth, posterLive, fallbackDelta, onSwitch }: Props) {
  const { t } = useTranslation();
  const country = useShopContextStore((s) => s.country) ?? "SE";
  const locale = useShopContextStore((s) => s.locale);
  const [canvasLive, setCanvasLive] = useState<ShopifyMoney | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCanvasLive(null);
    getShopifyPrices(canvasHandle, country, [{ size, variant: canvasDepth }], "canvas")
      .then((m) => {
        if (!cancelled) setCanvasLive(m.get(`${size}|${canvasDepth}`) ?? null);
      })
      .catch(() => {
        /* Reservberäkningen används. */
      });
    return () => {
      cancelled = true;
    };
  }, [canvasHandle, country, size, canvasDepth]);

  let delta: string | null = null;
  if (canvasLive && posterLive && canvasLive.currencyCode === posterLive.currencyCode) {
    const diff = canvasLive.amount - posterLive.amount;
    if (diff <= 0) return null;
    delta = formatMoneyDelta(diff, canvasLive.currencyCode, locale);
  } else {
    delta = fallbackDelta;
  }
  if (!delta || delta.startsWith("−")) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 px-4 py-3">
      <p className="text-sm leading-snug">{t("format.canvasUpsell", { delta: delta.replace(/^\+/, "") })}</p>
      <button
        type="button"
        onClick={onSwitch}
        className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
      >
        {t("format.canvasUpsellCta")}
      </button>
    </div>
  );
}
