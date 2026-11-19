import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Engångsverktyg för prisplanen 19 november 2026 (se
 * supabase/functions/_shared/price-plan.ts). Provkörningen läser bara;
 * "Tillämpa" skriver priser och rabatter i Shopify.
 */
export default function PricePlanPanel() {
  const [busy, setBusy] = useState<"dry" | "apply" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [dryDone, setDryDone] = useState(false);

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "dry" : "apply");
    setResult(null);
    const { data, error } = await supabase.functions.invoke("shopify-apply-pricing", { body: { dryRun } });
    setBusy(null);
    if (error) {
      setResult(`Fel: ${error.message}`);
      return;
    }
    setResult(JSON.stringify(data, null, 2));
    if (dryRun && data?.ok) setDryDone(true);
  };

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-2" data-testid="price-plan-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 shrink-0" />
          <span>Prisplan 19 november: ramar, canvas, Danmark/Finland och rabatter</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => run(true)} disabled={busy !== null}>
            {busy === "dry" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Provkör prisplan
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (window.confirm("Skriva de nya priserna och rabatterna till Shopify?")) run(false);
            }}
            disabled={busy !== null || !dryDone}
          >
            {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Tillämpa prisplan
          </Button>
        </div>
      </div>
      {result ? (
        <pre className="max-h-80 overflow-auto rounded bg-background p-2 text-xs" data-testid="price-plan-result">
          {result}
        </pre>
      ) : null}
    </div>
  );
}
