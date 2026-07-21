import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { loadAllConfigsRaw, type ProductConfig } from "@/lib/product-config";
import { Loader2, ExternalLink, Zap, Pencil, Plus, CheckCircle2, AlertCircle, Download, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { resolveTemplate } from "@/lib/template-migrate";
import type { Template } from "@/lib/template-schema";
import CreateTemplateDialog from "@/components/admin/CreateTemplateDialog";
import TemplateThumbnail from "@/components/admin/TemplateThumbnail";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfigWithTemplate extends ProductConfig {
  __template: Template;
}

interface InstallStatus {
  shop: string;
  installed: boolean;
  scopes: string | null;
  installedAt: string | null;
}

export default function AdminConfigs() {
  const [configs, setConfigs] = useState<ConfigWithTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [searchParams] = useSearchParams();

  const refreshInstallStatus = async () => {
    const { data, error } = await supabase.functions.invoke("shopify-oauth-status");
    if (!error && data) setInstallStatus(data as InstallStatus);
  };

  useEffect(() => {
    (async () => {
      const all = await loadAllConfigsRaw();
      const enriched = all.map((c) => {
        const raw = (c as unknown as { template?: unknown }).template;
        const { template } = resolveTemplate(c, raw);
        return { ...c, __template: template };
      });
      setConfigs(enriched);
      setLoading(false);
    })();
    refreshInstallStatus();
  }, []);

  useEffect(() => {
    if (searchParams.get("installed") === "1") {
      toast.success("Shopify-app installerad ✓");
      refreshInstallStatus();
    }
  }, [searchParams]);

  const startInstall = async () => {
    setInstalling(true);
    try {
      const { data, error } = await supabase.functions.invoke("shopify-oauth-install", {
        body: {},
      });
      if (error || !data?.installUrl) {
        toast.error("Kunde inte starta installationen", {
          description: error?.message ?? data?.error ?? "okänt fel",
        });
        return;
      }
      window.open(data.installUrl as string, "_blank", "noopener,noreferrer");
      toast.info("Installationsfönster öppnat", {
        description: "Godkänn appen i Shopify-fliken — sidan uppdateras automatiskt vid retur.",
      });
    } finally {
      setInstalling(false);
    }
  };

  const syncToShopify = async () => {
    setSyncing(true);
    let okCount = 0;
    const failures: string[] = [];
    for (const cfg of configs) {
      const { data, error } = await supabase.functions.invoke("shopify-sync-template", {
        body: { handle: cfg.shopify_handle },
      });
      if (error || !data?.ok) {
        failures.push(`${cfg.shopify_handle}: ${error?.message ?? data?.error ?? "fel"}`);
      } else {
        okCount += 1;
      }
    }
    setSyncing(false);
    if (failures.length === 0) {
      toast.success("Synkad till Shopify", { description: `${okCount} mall(ar) uppdaterade` });
    } else {
      toast.warning(`Synk klar med ${failures.length} fel`, {
        description: failures.slice(0, 3).join(" · "),
      });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold">Produktkonfigurationer</h1>
              <p className="text-sm text-muted-foreground">Layouter, kartstilar, storlekar och Gelato-mappning</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link to="/admin/analytics">
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Analytics
                </Link>
              </Button>
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Skapa ny mall
              </Button>
              <Button onClick={() => setConfirmSyncOpen(true)} disabled={syncing || !installStatus?.installed || configs.length === 0}>
                {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                Synka till Shopify
              </Button>
            </div>
          </div>

          {/* Shopify app install status */}
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              {installStatus?.installed ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">
                    Shopify-app installerad på <span className="font-mono">{installStatus.shop}</span>
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <span className="truncate">
                    Shopify-app ej installerad{installStatus?.shop ? <> på <span className="font-mono">{installStatus.shop}</span></> : null} — synkning är inaktiverad tills appen är installerad.
                  </span>
                </>
              )}
            </div>
            <Button size="sm" variant={installStatus?.installed ? "outline" : "default"} onClick={startInstall} disabled={installing}>
              {installing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Download className="h-4 w-4 mr-2" />}
              {installStatus?.installed ? "Installera om" : "Installera Shopify-app"}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {configs.map((c) => {
              const isMulti = c.is_consolidated && (c.enabled_product_types?.length ?? 0) > 0;
              const thumbType = isMulti ? c.enabled_product_types![0] : c.product_type;
              const typeBadges = isMulti ? c.enabled_product_types! : [c.product_type];
              return (
              <Card key={c.id} className="p-5">
                <div className="flex gap-4">
                  <TemplateThumbnail template={c.__template} productType={thumbType} />
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold truncate">{c.title}</h2>
                        <p className="text-xs text-muted-foreground font-mono truncate">{c.shopify_handle}</p>
                      </div>
                      <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[50%]">
                        {typeBadges.map((t) => (
                          <span key={t} className="text-[10px] uppercase tracking-wider bg-secondary text-secondary-foreground px-2 py-1 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      <div>{c.__template.defaultLayout.portrait.layers.length} lager (stående)</div>
                      <div>{c.__template.publishedAt ? "Publicerad" : "Draft"}</div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button asChild variant="default" size="sm" className="flex-1">
                        <Link to={`/admin/designer/${c.shopify_handle}`}>
                          <Pencil className="h-3 w-3 mr-1" />
                          Redigera
                        </Link>
                      </Button>
                      <Button asChild variant="outline" size="sm" className="flex-1">
                        <Link to={`/editor?handle=${c.shopify_handle}`}>
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Editor
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
              );
            })}
          </div>
        )}

        {!loading && configs.length === 0 && (
          <div className="mt-8 p-8 rounded-lg border border-dashed text-center text-sm text-muted-foreground">
            Inga mallar än. Klicka "Skapa ny mall" för att börja.
          </div>
        )}
      </main>

      <CreateTemplateDialog open={createOpen} onOpenChange={setCreateOpen} />

      <AlertDialog open={confirmSyncOpen} onOpenChange={setConfirmSyncOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Synka alla mallar till Shopify?</AlertDialogTitle>
            <AlertDialogDescription>
              {configs.length} mall{configs.length === 1 ? "" : "ar"} kommer skickas till Shopify. Befintliga produkter med samma handle uppdateras (titel, varianter, metafält). Vill du fortsätta?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmSyncOpen(false);
                syncToShopify();
              }}
            >
              Ja, synka
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
