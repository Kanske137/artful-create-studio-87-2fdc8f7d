import { Loader2, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface Props {
  price: string;
  /** Ordinarie pris (formaterat) när varianten är på rea — visas överstruket
   *  bredvid reapriset tillsammans med REA-badgen. */
  compareAtPrice?: string | null;
  summary?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Förklaring som visas när knappen är inaktiverad — talar om VAD kunden
   *  behöver göra innan beställning (t.ex. ladda upp bild / trycka Skapa). */
  disabledHint?: string;
  onAdd: () => void;
  /** Show a pulsing "Är du nöjd?"-badge above the cart button (mobile only). */
  showCartHint?: boolean;
  className?: string;
}

export function StickyCta({ price, compareAtPrice, summary, loading, disabled, disabledHint, onAdd, showCartHint, className }: Props) {
  const { t } = useTranslation();
  const hintVisible = !!showCartHint && !loading && !disabled;
  return (
    <div
      className={cn(
        "relative w-full bg-foreground text-background border-t border-foreground/20",
        "flex items-center gap-3 px-4 py-3",
        className,
      )}
    >
      {hintVisible && (
        <span
          aria-hidden
          className="md:hidden pointer-events-none absolute right-6 -top-3 z-10 whitespace-nowrap rounded-sm bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-foreground shadow-md origin-center animate-pulse-scale"
        >
          {t("cart.readyHint")}
        </span>
      )}
      <div className="min-w-0 flex-1">
        {summary && (
          <div className="text-[10px] uppercase tracking-wider opacity-60 truncate">{summary}</div>
        )}
        {compareAtPrice ? (
          <div className="flex items-center gap-2 leading-tight flex-wrap">
            <span className="text-base md:text-lg font-semibold text-red-400">{price}</span>
            <span className="text-xs md:text-sm line-through opacity-60">{compareAtPrice}</span>
            <span className="rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              {t("sale.badge", { defaultValue: "REA -25%" })}
            </span>
          </div>
        ) : (
          <div className="text-base md:text-lg font-semibold leading-tight">{price}</div>
        )}
        {disabled && !loading && disabledHint && (
          <div className="text-[11px] opacity-85 leading-tight mt-0.5">{disabledHint}</div>
        )}
      </div>
      <Button
        onClick={onAdd}
        disabled={loading || disabled}
        aria-label={t("common.addToCart")}
        className="h-12 md:h-12 rounded-full bg-background text-foreground hover:bg-background/90 px-5 md:px-7 font-semibold disabled:opacity-50"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4" />
            <span>{t("cart.order", { defaultValue: "Order" })}</span>
          </span>
        )}
      </Button>
    </div>
  );
}
