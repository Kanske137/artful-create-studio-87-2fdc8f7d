import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { NavRail } from "./NavRail";
import { ControlPanel, useAvailableSections, type SectionId } from "./ControlPanel";
import type { ProductConfig, ProductType } from "@/lib/product-config";
import { cn } from "@/lib/utils";
import { postEditorResize } from "@/lib/iframe-resize";
import { AiBusyOverlay } from "./AiBusyOverlay";
import { useIsAnyAiBusy } from "@/stores/aiBusyStore";
import { useResultActionsStore } from "@/stores/resultActionsStore";
import { useParentViewport } from "@/hooks/useParentViewport";

interface Props {
  configs: ProductConfig[];
  activeHandle: string;
  activeProductType: ProductType;
  onProductChange: (handle: string, productType: ProductType) => void;
  preview: ReactNode;
  cta: ReactNode;
}

export function EditorShell({ configs, activeHandle, activeProductType, onProductChange, preview, cta }: Props) {
  const { t } = useTranslation();
  const sections = useAvailableSections();
  const [activeId, setActiveId] = useState<SectionId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [snap, setSnap] = useState<number | string | null>("content");
  const isAiBusy = useIsAnyAiBusy();
  const { visibleTop, visibleHeight } = useParentViewport();
  const pendingSection = useResultActionsStore((s) => s.pendingSection);
  const consumePendingSection = useResultActionsStore((s) => s.consumePendingSection);


  useEffect(() => {
    if (sections.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !sections.some((s) => s.id === activeId)) {
      setActiveId(sections[0]!.id);
    }
  }, [sections, activeId]);

  // "Byt stil"-knappen i resultat-/köp-zonen ber EditorShell öppna en sektion
  // (t.ex. forvandling) + fälla ut mobil-lådan, så kunden når stilval direkt.
  useEffect(() => {
    if (!pendingSection) return;
    if (sections.some((s) => s.id === pendingSection)) {
      setActiveId(pendingSection);
      setMobileOpen(true);
    }
    consumePendingSection();
  }, [pendingSection, sections, consumePendingSection]);

  // Rapportera ny höjd efter tab-byte (dubbel RAF för att invänta layout).
  useEffect(() => {
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => postEditorResize());
      (postEditorResize as any)._r2 = r2;
    });
    return () => cancelAnimationFrame(r1);
  }, [activeId]);

  // Stäng mobil bottom-sheet automatiskt så fort en AI-process startar,
  // så kunden ser editorn/förhandsvisningen under blur-overlayen.
  useEffect(() => {
    if (isAiBusy && mobileOpen) setMobileOpen(false);
  }, [isAiBusy, mobileOpen]);

  // Återställ snap till "content" varje gång drawern öppnas eller fliken byts,
  // så drawern alltid startar i kompakt innehållshöjd.
  useEffect(() => {
    if (mobileOpen) setSnap("content");
  }, [mobileOpen, activeId]);

  const onSelectMobile = (id: SectionId) => {
    if (isAiBusy) return;
    setActiveId(id);
    setMobileOpen(true);
  };


  const activeMeta = sections.find((s) => s.id === activeId);
  const activeLabel = activeMeta ? t(activeMeta.labelKey) : "";

  const sectionContent = activeId ? (
    <ControlPanel
      configs={configs}
      activeHandle={activeHandle}
      activeProductType={activeProductType}
      onProductChange={onProductChange}
      sectionId={activeId}
    />
  ) : null;

  return (
    <div className="editor-root flex flex-col">
      <div
        className={cn(
          "flex flex-col",
          isAiBusy && "pointer-events-none select-none",
        )}
        aria-hidden={isAiBusy || undefined}
      >
      {/* Desktop layout — innehållsdriven höjd utan intern scroll. */}
      <div className="editor-body hidden lg:flex items-stretch min-h-[1100px]">
        <NavRail
          sections={sections}
          activeId={(activeId ?? sections[0]?.id) as SectionId}
          onSelect={(id) => setActiveId(id)}
          orientation="vertical"
          className="shrink-0"
        />
        <aside className="section-panel w-[340px] shrink-0 border-r bg-background min-h-0">
          <div className="p-6 space-y-5">
            {activeMeta && (
              <header className="space-y-1">
                <h2 className="font-serif-display text-2xl font-semibold tracking-tight">{activeLabel}</h2>
              </header>
            )}
            {sectionContent}
          </div>
        </aside>
        <main className="preview-area flex-1 paper-grain flex items-center justify-center p-6 lg:p-10">{preview}</main>
      </div>

      {/* Mobile/tablet layout */}
      <div className="flex lg:hidden flex-col">
        <div className="preview-area paper-grain w-full flex items-center justify-center p-3">{preview}</div>
        <NavRail
          sections={sections}
          activeId={(activeId ?? sections[0]?.id) as SectionId}
          onSelect={onSelectMobile}
          orientation="horizontal"
          className="shrink-0"
        />
      </div>

      {/* CTA — flex row i botten, inte fixed */}
      <div className="shrink-0">{cta}</div>

      {/* Mobil bottom sheet — ankras till parent-fönstrets synliga del
          (via SHOP_VIEWPORT från Shopify-temat) så drawern alltid är fullt
          synlig oavsett var i iframen kunden står. Innehållet har egen
          scroll och `overscroll-behavior: contain` stoppar scroll-chaining
          till parent. */}
      <Drawer
        open={mobileOpen && !isAiBusy}
        onOpenChange={(o) => !isAiBusy && setMobileOpen(o)}
        snapPoints={["content", 0.95]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
      >
        <DrawerContent
          className={cn("lg:hidden flex flex-col")}
          style={
            visibleHeight > 0
              ? {
                  position: "fixed",
                  top: Math.round(visibleTop + 40),
                  bottom: "auto",
                  maxHeight: Math.round(visibleHeight - 40),
                  height: "auto",
                }
              : undefined
          }
        >
          <div className="flex items-center justify-between px-5 pt-2 pb-3 shrink-0">
            <DrawerTitle className="font-serif-display text-xl font-semibold">{activeLabel}</DrawerTitle>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label={t("common.close", { defaultValue: "Stäng" })}
              className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div
            className="px-5 pb-24 overflow-y-auto"
            style={{
              overscrollBehavior: "contain",
              WebkitOverflowScrolling: "touch",
              paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)",
            }}
          >
            {sectionContent}
          </div>
        </DrawerContent>
      </Drawer>
      </div>

      {/* Global AI-busy overlay — utanför pointer-events-none wrappern */}
      <AiBusyOverlay />
    </div>
  );
}

