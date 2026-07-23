// E-postdialog för prenumerant-gaten (Fas 4). Monteras EN gång i EditorPage
// och öppnas via requestSubscriberGate() från genereringssektionerna när
// gratisgenereringen är förbrukad. Nyhetsbrevsrutan är frivillig och aldrig
// förikryssad (GDPR — registreringen är inte ett marknadsföringssamtycke).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerSubscriberEmail, useSubscriberGateStore } from "@/lib/subscriber-gate";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function SubscriberGateDialog() {
  const { t } = useTranslation();
  const open = useSubscriberGateStore((s) => s.open);
  const resolve = useSubscriberGateStore((s) => s.resolve);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (registered: boolean) => resolve?.(registered);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!EMAIL_RE.test(trimmed)) {
      setError(t("subGate.errorInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerSubscriberEmail(trimmed, consent);
      toast.success(t("subGate.successToast"));
      close(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message === "invalid_email"
          ? t("subGate.errorInvalid")
          : t("subGate.errorGeneric"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) close(false);
      }}
    >
      {/* z-[80]: AI-overlayen ligger på z-[60] — dialogen MÅSTE ligga över den
          (gaten kan öppnas medan overlayen är aktiv). Utanförklick stänger
          inte (annars försvinner dialogen av misstag under pågående flöde);
          kunden stänger medvetet via X eller Esc. */}
      <DialogContent
        className="z-[80] sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("subGate.title")}</DialogTitle>
          <DialogDescription>{t("subGate.body")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="subgate-email">{t("subGate.emailLabel")}</Label>
            <Input
              id="subgate-email"
              type="email"
              autoComplete="email"
              placeholder={t("subGate.emailPlaceholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              disabled={busy}
              className="mt-0.5"
            />
            <span>{t("subGate.newsletterLabel")}</span>
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t("subGate.working") : t("subGate.submit")}
          </Button>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("subGate.privacyNote")}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
