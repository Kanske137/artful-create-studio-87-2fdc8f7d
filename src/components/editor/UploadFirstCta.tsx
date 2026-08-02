// Steg 1-CTA: stor "Ladda upp ditt foto"-knapp OVANPÅ förhandsvisningen tills
// kunden laddat upp något. Bakgrund (tratt-data 2026-08-02): bara 21 % av
// editoröppningarna ledde till en uppladdning, men ALLA som väl öppnade
// fotoväljaren laddade upp — flaskhalsen är att hitta dit, särskilt på mobil
// (59 % av sessionerna). Panelfliken räcker alltså inte som enda ingång.
//
// Beteende:
//  - Singelfoto (photo-lager eller aiPhoto utan multiface): öppnar fil-
//    väljaren DIREKT (ett tryck), och öppnar sedan rätt panelflik så
//    "Skapa nu"-knappen är nästa synliga steg.
//  - Multiface (par/grupp): öppnar Förvandling-fliken där varje slot har sin
//    egen uppladdningsruta (flera filer behövs — ingen enskild direktväljare).
//  - Döljs permanent så fort NÅGOT foto/porträtt/resultat finns i sessionen.
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import { useResultActionsStore } from "@/stores/resultActionsStore";
import { track } from "@/lib/analytics";
import type { TemplateLayer } from "@/lib/template-schema";

type AiPhotoLayer = Extract<TemplateLayer, { type: "aiPhoto" }>;
type PhotoLayer = Extract<TemplateLayer, { type: "photo" }>;

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic";

export function UploadFirstCta() {
  const { t } = useTranslation();
  const templateLayers = useEditorStore((s) => s.templateLayers);
  const photoSources = useEditorStore((s) => s.photoSources);
  const aiPhotoSources = useEditorStore((s) => s.aiPhotoSources);
  const aiPhotoResults = useEditorStore((s) => s.aiPhotoResults);
  const multiFacePortraits = useEditorStore((s) => s.multiFacePortraits);
  const setAiPhotoSource = useEditorStore((s) => s.setAiPhotoSource);
  const setPhotoSourceFor = useEditorStore((s) => s.setPhotoSourceFor);
  const openSection = useResultActionsStore((s) => s.openSection);
  const inputRef = useRef<HTMLInputElement>(null);

  const layers = templateLayers();
  const aiLayer = layers.find((l): l is AiPhotoLayer => l.type === "aiPhoto");
  const photoLayer = layers.find((l): l is PhotoLayer => l.type === "photo");
  if (!aiLayer && !photoLayer) return null; // ren kart/text-produkt — inget foto att kräva

  const isMulti = (aiLayer?.defaults.multiFaceSwap?.slots?.length ?? 0) >= 2;

  const hasAnyUpload =
    Object.keys(photoSources).length > 0 ||
    Object.keys(aiPhotoSources).length > 0 ||
    Object.values(aiPhotoResults).some(Boolean) ||
    Object.values(multiFacePortraits).some(
      (slots) => slots && Object.keys(slots).length > 0,
    );
  if (hasAnyUpload) return null;

  const targetSection = aiLayer ? "forvandling" : "bild";

  const onClick = () => {
    track("photo_picker_opened", { source: "preview_cta" });
    if (isMulti) {
      openSection(targetSection);
      return;
    }
    inputRef.current?.click();
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (aiLayer && !isMulti) setAiPhotoSource(aiLayer.id, file, url);
    else if (photoLayer) setPhotoSourceFor(photoLayer.id, file, url);
    // Öppna panelfliken så nästa steg ("Skapa nu" / justera) är synligt.
    openSection(targetSection);
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center pointer-events-none pb-4 md:pb-6">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={onClick}
        className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-2xl bg-primary px-6 py-3 text-primary-foreground shadow-lg ring-1 ring-black/10 transition-transform hover:scale-[1.03] active:scale-[0.98]"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Upload className="h-4 w-4" />
          {isMulti
            ? t("editor.uploadFirstCtaMulti", { defaultValue: "Ladda upp era foton" })
            : t("editor.uploadFirstCta", { defaultValue: "Ladda upp ditt foto" })}
        </span>
        <span className="text-[11px] opacity-90">
          {t("editor.uploadFirstHint", { defaultValue: "Börja här – vi gör resten" })}
        </span>
      </button>
    </div>
  );
}
