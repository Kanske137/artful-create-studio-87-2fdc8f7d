// Admin: översättningar av en malls texter (layoutnamn, AI-stilar, motiv,
// varianter, förvalda texter och lagernamn) till engelska, danska och finska.
//
// Svenska är källan. Varje fält visar den gemensamma ordlistans översättning
// som platshållare; skriver admin något här sparas det i mallen
// (template.i18n) och vinner över ordlistan. Tomt fält = ordlistan, eller
// svenskan om ordlistan saknar texten. Ändringarna läggs i mallen när dialogen
// stängs med "Använd" och sparas först med Spara draft eller Publicera.
import { useMemo, useState } from "react";
import { Eye, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Template } from "@/lib/template-schema";
import {
  collectTranslatableStrings,
  isValidTranslation,
  tokensOf,
  translationStatus,
  TRANSLATABLE_KIND_ORDER,
  TRANSLATION_LOCALES,
  type TranslatableKind,
  type TranslationLocale,
  type TranslationStatus,
} from "@/lib/template-i18n";
import { SAME_IN_ALL_LANGUAGES, TEMPLATE_STRINGS } from "@/i18n/template-strings";

const LANG_LABEL: Record<TranslationLocale, string> = { en: "Engelska", da: "Danska", fi: "Finska" };

const KIND_LABEL: Record<TranslatableKind, string> = {
  layout: "Layoutnamn",
  aiStyle: "AI-stilar",
  motif: "Motiv",
  slot: "Personer i motivet",
  variantLabel: "Variantväljarens rubrik",
  variant: "Innehållsvarianter",
  text: "Förvalda texter",
  place: "Kartans förvalda plats",
  layerName: "Lagernamn (rubriker i kundpanelen)",
};

const STATUS_DOT: Record<TranslationStatus, string> = {
  template: "bg-primary",
  common: "bg-emerald-500",
  same: "bg-emerald-500",
  missing: "bg-amber-500",
};

const STATUS_TITLE: Record<TranslationStatus, string> = {
  template: "Mallens egen översättning",
  common: "Från den gemensamma ordlistan",
  same: "Likadan på alla språk",
  missing: "Saknas – svenskan visas",
};

type Draft = Partial<Record<TranslationLocale, Record<string, string>>>;

interface Props {
  template: Template;
  handle: string;
  onApply: (i18n: Template["i18n"]) => void;
}

export default function TemplateTranslationsDialog({ template, handle, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [onlyMissing, setOnlyMissing] = useState(false);

  const strings = useMemo(() => collectTranslatableStrings(template), [template]);
  // Stängd dialog räknar på mallen, öppen på utkastet.
  const effective = useMemo(() => (open ? { i18n: draft } : { i18n: template.i18n }), [open, draft, template.i18n]);

  const statusOf = (source: string, lang: TranslationLocale) =>
    translationStatus(source, lang, effective, TEMPLATE_STRINGS, SAME_IN_ALL_LANGUAGES);

  // Räkna per unik källtext (samma text kan förekomma i flera grupper).
  const uniqueSources = useMemo(() => [...new Set(strings.map((s) => s.source))], [strings]);
  const coverage = TRANSLATION_LOCALES.map((lang) => ({
    lang,
    done: uniqueSources.filter((s) => statusOf(s, lang) !== "missing").length,
  }));
  const missingTotal = coverage.reduce((n, c) => n + (uniqueSources.length - c.done), 0);

  function openDialog(next: boolean) {
    if (next) {
      const copy: Draft = {};
      for (const lang of TRANSLATION_LOCALES) copy[lang] = { ...(template.i18n?.[lang] ?? {}) };
      setDraft(copy);
    }
    setOpen(next);
  }

  function setValue(lang: TranslationLocale, source: string, value: string) {
    setDraft((prev) => {
      const forLang = { ...(prev[lang] ?? {}) };
      if (value.trim() === "") delete forLang[source];
      else forLang[source] = value;
      return { ...prev, [lang]: forLang };
    });
  }

  function apply() {
    const clean: Record<string, Record<string, string>> = {};
    for (const lang of TRANSLATION_LOCALES) {
      const entries = Object.entries(draft[lang] ?? {}).filter(([, v]) => v.trim() !== "");
      if (entries.length > 0) clean[lang] = Object.fromEntries(entries);
    }
    // Bevara ev. andra språk som redan finns i mallen.
    for (const [lang, dict] of Object.entries(template.i18n ?? {})) {
      if (!(TRANSLATION_LOCALES as readonly string[]).includes(lang)) clean[lang] = dict;
    }
    onApply(Object.keys(clean).length > 0 ? clean : undefined);
    setOpen(false);
  }

  const visible = strings.filter(
    (s) => !onlyMissing || TRANSLATION_LOCALES.some((lang) => statusOf(s.source, lang) === "missing"),
  );
  const groups = TRANSLATABLE_KIND_ORDER.map((kind) => ({
    kind,
    items: visible.filter((s) => s.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Översättningar till engelska, danska och finska">
          <Languages className="h-4 w-4 mr-2" />
          Översättningar
          {missingTotal > 0 && (
            <span className="ml-2 rounded-full bg-amber-100 text-amber-800 px-1.5 text-[11px] font-medium">
              {missingTotal}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl">
        <DialogHeader>
          <DialogTitle>Översättningar</DialogTitle>
          <DialogDescription>
            Svenska är källan. Ett tomt fält använder den gemensamma ordlistan (grå text), annars visas
            svenskan. Det du skriver här gäller bara den här mallen. Platshållare som [[city]] måste finnas
            kvar i översättningen.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex flex-wrap gap-4">
            {coverage.map((c) => (
              <span key={c.lang} className={cn(c.done < uniqueSources.length && "text-amber-700")}>
                {LANG_LABEL[c.lang]} {c.done} av {uniqueSources.length}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1 text-muted-foreground" title="Visar den sparade mallen">
              <Eye className="h-3.5 w-3.5" />
              Visa sparad mall som kund:
              {TRANSLATION_LOCALES.map((lang) => (
                <a
                  key={lang}
                  className="underline underline-offset-2 hover:text-foreground"
                  href={`/editor?handle=${encodeURIComponent(handle)}&preview=draft&locale=${lang}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {lang.toUpperCase()}
                </a>
              ))}
            </span>
            <span className="flex items-center gap-2">
              <Switch id="only-missing" checked={onlyMissing} onCheckedChange={setOnlyMissing} />
              <Label htmlFor="only-missing" className="text-sm font-normal">
                Bara saknade
              </Label>
            </span>
          </div>
        </div>

        <div className="max-h-[65vh] overflow-y-auto pr-1 space-y-6">
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">Inget saknar översättning.</p>
          )}
          {groups.map((g) => (
            <section key={g.kind} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {KIND_LABEL[g.kind]}
              </h3>
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1fr))] gap-2 text-[11px] text-muted-foreground">
                <span>Svenska</span>
                {TRANSLATION_LOCALES.map((lang) => (
                  <span key={lang}>{LANG_LABEL[lang]}</span>
                ))}
              </div>
              {g.items.map((item) => {
                const multiline = item.source.includes("\n") || item.source.length > 60;
                return (
                  <div
                    key={`${g.kind}:${item.source}`}
                    className="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,1fr))] gap-2 items-start"
                  >
                    <p className="text-sm whitespace-pre-wrap break-words py-1.5">{item.source}</p>
                    {TRANSLATION_LOCALES.map((lang) => {
                      const own = draft[lang]?.[item.source] ?? "";
                      const common = TEMPLATE_STRINGS[lang]?.[item.source];
                      const status = statusOf(item.source, lang);
                      const placeholder = common
                        ? common
                        : SAME_IN_ALL_LANGUAGES.has(item.source)
                          ? `${item.source} (samma på alla språk)`
                          : "Saknas – svenskan visas";
                      const tokenError = own.trim() !== "" && !isValidTranslation(item.source, own);
                      const Field = multiline ? Textarea : Input;
                      return (
                        <div key={lang} className="space-y-1">
                          <div className="relative">
                            <Field
                              value={own}
                              placeholder={placeholder}
                              onChange={(e) => setValue(lang, item.source, e.target.value)}
                              className={cn("text-sm pr-6", multiline && "min-h-[88px]", tokenError && "border-destructive")}
                              aria-label={`${LANG_LABEL[lang]}: ${item.source}`}
                            />
                            <span
                              className={cn("absolute right-2 top-3 h-2 w-2 rounded-full", STATUS_DOT[status])}
                              title={STATUS_TITLE[status]}
                            />
                          </div>
                          {tokenError && (
                            <p className="text-[11px] text-destructive">
                              Måste innehålla {tokensOf(item.source) || "samma platshållare"}. Används inte.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          ))}
        </div>

        <DialogFooter className="items-center sm:justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Sparas i mallen när du trycker Spara draft eller Publicera.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={apply}>Använd</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
