import { Truck, Sparkles, PackageCheck, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deliveryEstimate } from "@/lib/delivery";

interface Props {
  /** Intern produkttyp-slug (posters/canvas/aluminum/acrylic). */
  productType?: string | null;
  /** ISO-landskod från butikskontexten (t.ex. "SE", "DE"). */
  country?: string | null;
  /** Färdigformaterad gräns för fri frakt i kundens valuta (utelämnas → dölj). */
  freeShippingDisplay?: string;
}

/** Slank trygghetsrad ovanför köp-CTA:n. Leveranstiden beräknas per produkttyp
 *  + marknad enligt fraktpolicyn (se src/lib/delivery.ts). Visas på alla
 *  produkter, inte bara drinkpostern. */
export function DeliveryTrustRow({ productType, country, freeShippingDisplay }: Props) {
  const { t } = useTranslation();
  const est = deliveryEstimate(productType, country);

  const items: { icon: typeof Truck; label: string }[] = [
    { icon: Truck, label: t("trust.deliveryDays", { min: est.minDays, max: est.maxDays }) },
    ...(freeShippingDisplay
      ? [{ icon: Sparkles, label: t("trust.freeShipping", { amount: freeShippingDisplay }) }]
      : []),
    { icon: PackageCheck, label: t("trust.madeInEu") },
    { icon: ShieldCheck, label: t("trust.securePayment") },
  ];

  return (
    <div className="w-full bg-muted/60 border-t border-border flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-2">
      {items.map((it, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground whitespace-nowrap"
        >
          <it.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}
