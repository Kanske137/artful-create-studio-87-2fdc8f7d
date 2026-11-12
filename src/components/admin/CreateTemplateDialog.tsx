// Dialog for creating a new product template (config row).
// Asks for title, auto-slugged Shopify handle, and which product types to seed.
// Inserts one product_configs row PER selected product type — they all share
// the same template_slug so they appear together in the customer Format toggle.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PRODUCT_VARIANTS } from "@/lib/product-defaults";
import type { Template } from "@/lib/template-schema";
import type { ProductType } from "@/lib/product-config";
import { applyRaceSeed } from "@/lib/race/seed-template";

type Preset = "empty" | "race";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Kind = "poster" | "canvas" | "aluminum" | "acrylic";

const KIND_META: Record<
  Kind,
  { i18nKey: string; productType: ProductType; suffix: string }
> = {
  poster:   { i18nKey: "productKind.poster",   productType: "posters",  suffix: "-poster" },
  canvas:   { i18nKey: "productKind.canvas",   productType: "canvas",   suffix: "-canvas" },
  aluminum: { i18nKey: "productKind.aluminum", productType: "aluminum", suffix: "-aluminum" },
  acrylic:  { i18nKey: "productKind.acrylic",  productType: "acrylic",  suffix: "-acrylic" },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

function buildSeedTemplate(kinds: Kind[]): Template {
  const productOptions: Template["productOptions"] = {};
  if (kinds.includes("poster")) {
    productOptions.poster = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.poster.sizes],
      allowedFrames: [...DEFAULT_PRODUCT_VARIANTS.poster.frames],
    };
  }
  if (kinds.includes("canvas")) {
    productOptions.canvas = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.canvas.sizes],
      allowedDepths: [...DEFAULT_PRODUCT_VARIANTS.canvas.depths],
    };
  }
  if (kinds.includes("aluminum")) {
    productOptions.aluminum = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.aluminum.sizes],
      allowedMaterials: [...DEFAULT_PRODUCT_VARIANTS.aluminum.materials],
    };
  }
  if (kinds.includes("acrylic")) {
    productOptions.acrylic = {
      enabled: true,
      allowedSizes: [...DEFAULT_PRODUCT_VARIANTS.acrylic.sizes],
      allowedFinishes: [...DEFAULT_PRODUCT_VARIANTS.acrylic.finishes],
    };
  }
  return {
    version: 1,
    publishedAt: null,
    productOptions,
    orientations: ["portrait", "landscape"],
    defaultLayout: {
      portrait: { aspect: "3:4", background: { color: "#EFE7D6" }, layers: [] },
      landscape: { aspect: "4:3", background: { color: "#EFE7D6" }, layers: [] },
    },
    sizeOverrides: {},
    extraLayouts: [],
    contentVariants: [],
  };
}

export default function CreateTemplateDialog({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEdited, setHandleEdited] = useState(false);
  const [selected, setSelected] = useState<Record<Kind, boolean>>({
    poster: true,
    canvas: true,
    aluminum: true,
    acrylic: true,
  });
  const [saving, setSaving] = useState(false);
  const [preset, setPreset] = useState<Preset>("empty");

  useEffect(() => {
    if (!handleEdited) setHandle(slugify(title));
  }, [title, handleEdited]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setHandle("");
      setHandleEdited(false);
      setSelected({ poster: true, canvas: true, aluminum: true, acrylic: true });
      setSaving(false);
      setPreset("empty");
    }
  }, [open]);

  function toggleKind(kind: Kind, checked: boolean) {
    setSelected((s) => ({ ...s, [kind]: checked }));
  }

  async function handleCreate() {
    if (!title.trim() || !handle.trim()) {
      toast.error("Titel och handle krävs");
      return;
    }
    const kinds = (Object.keys(selected) as Kind[]).filter((k) => selected[k]);
    if (kinds.length === 0) {
      toast.error("Välj minst en produkttyp");
      return;
    }
    setSaving(true);

    // Konsoliderad mall: en rad i product_configs, en produkt i Shopify.
    // Handle = template_slug = ren slug utan -poster/-canvas-suffix.
    const trimmedHandle = handle.trim();
    const templateSlug = trimmedHandle.replace(/-(poster|posters|canvas|aluminum|acrylic)$/i, "");
    const enabledProductTypes = kinds.map((k) => KIND_META[k].productType);

    const tpl = preset === "race" ? applyRaceSeed(buildSeedTemplate(kinds)) : buildSeedTemplate(kinds);
    const baseTextConfig = {
      fonts: ["Inter", "Playfair Display"],
      maxChars: 24,
      defaultFont: "Inter",
    } as unknown as never;
    const baseStyles = ["light-v11", "dark-v11", "outdoors-v12", "satellite-v9"] as unknown as never;

    const { error } = await supabase.from("product_configs").insert({
      title: title.trim(),
      shopify_handle: templateSlug,
      template_slug: templateSlug,
      product_type: "multi" as unknown as never,
      is_consolidated: true,
      enabled_product_types: enabledProductTypes as unknown as never,
      template: tpl as unknown as never,
      layouts: {} as unknown as never,
      map_styles: baseStyles,
      text_config: baseTextConfig,
      sizes: [] as unknown as never,
      gelato_sku_map: {} as unknown as never,
    });
    if (error) {
      setSaving(false);
      toast.error("Kunde inte skapa", { description: error.message });
      return;
    }

    // Synka till Shopify (best-effort).
    const { data: syncData, error: syncErr } = await supabase.functions.invoke(
      "shopify-sync-template",
      { body: { handle: templateSlug } },
    );
    setSaving(false);
    if (syncErr || !syncData?.ok) {
      toast.warning("Mall skapad — Shopify-synk misslyckades", {
        description:
          syncErr?.message ??
          syncData?.error ??
          "Återanslut Shopify-integrationen i Lovable och kör Synka igen.",
      });
    } else {
      toast.success("Mall skapad och synkad till Shopify", {
        description: `${kinds.length} produkttyp(er) som varianter`,
      });
    }
    onOpenChange(false);
    navigate(`/admin/designer/${templateSlug}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Skapa ny mall</DialogTitle>
          <DialogDescription>
            En tom mall skapas. Du kan lägga till lager och varianter direkt efteråt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="tpl-title">Titel</Label>
            <Input
              id="tpl-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Personlig stadkarta"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tpl-handle">Shopify-handle</Label>
            <Input
              id="tpl-handle"
              value={handle}
              onChange={(e) => {
                setHandle(slugify(e.target.value));
                setHandleEdited(true);
              }}
              placeholder="personlig-stadkarta"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label>Startmall</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "empty", label: "Tom mall", hint: "Bygg från grunden" },
                { id: "race", label: "Löpartavla", hint: "Rutt, höjdprofil, statistik" },
              ] as const).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`rounded-md border p-3 text-left transition ${
                    preset === p.id ? "ring-2 ring-primary border-transparent" : "hover:bg-muted/40"
                  }`}
                >
                  <span className="block text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Produkttyper</Label>
            <p className="text-xs text-muted-foreground">
              En Shopify-produkt skapas där produkttyperna blir varianter (Produkttyp/Storlek/Utförande).
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(KIND_META) as Kind[]).map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/40"
                >
                  <Checkbox
                    checked={selected[k]}
                    onCheckedChange={(c) => toggleKind(k, c === true)}
                  />
                  <span className="text-sm font-medium">{t(KIND_META[k].i18nKey)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button onClick={handleCreate} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Skapa & öppna
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
