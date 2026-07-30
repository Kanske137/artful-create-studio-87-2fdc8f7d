// Kundfeedback under varje genereringsresultat (Paket B): "Blev det bra?"
// 👍 skickas direkt; 👎 fäller ut ett frivilligt "Vad blev fel?"-fält.
// En inskickning per resultat — nytt resultat (ny URL) nollställer.
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { designIdFromResultUrl, sendGenerationFeedback } from "@/lib/feedback";
import { cn } from "@/lib/utils";

interface GenerationFeedbackProps {
  resultUrl: string;
  handle?: string | null;
  provider?: string | null;
  className?: string;
}

export function GenerationFeedback({ resultUrl, handle, provider, className }: GenerationFeedbackProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"idle" | "comment" | "done">("idle");
  const [comment, setComment] = useState("");
  const [lastUrl, setLastUrl] = useState(resultUrl);
  if (lastUrl !== resultUrl) {
    // Nytt resultat sedan sist — börja om (tillåtet state-justering vid render).
    setLastUrl(resultUrl);
    setPhase("idle");
    setComment("");
  }

  const designId = designIdFromResultUrl(resultUrl);
  if (!designId) return null;

  const sendUp = () => {
    void sendGenerationFeedback({ designId, rating: "up", handle, provider });
    setPhase("done");
  };
  const sendDown = (withComment: boolean) => {
    void sendGenerationFeedback({
      designId,
      rating: "down",
      comment: withComment ? comment : undefined,
      handle,
      provider,
    });
    setPhase("done");
  };

  if (phase === "done") {
    return (
      <div className={cn("rounded-xl border bg-accent/20 px-3 py-2.5 text-sm text-muted-foreground", className)}>
        {t("feedback.thanks")}
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border bg-accent/20 p-3 space-y-2.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{t("feedback.question")}</span>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={sendUp}
            aria-label={t("feedback.up")}
          >
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => setPhase("comment")}
            aria-label={t("feedback.down")}
          >
            <ThumbsDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {phase === "comment" && (
        <div className="space-y-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("feedback.placeholder")}
            rows={2}
            maxLength={1000}
            className="text-sm"
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => sendDown(true)}>
              {t("feedback.send")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => sendDown(false)}>
              {t("feedback.skip")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
