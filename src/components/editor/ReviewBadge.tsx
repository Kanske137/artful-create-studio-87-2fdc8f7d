// Kompakt Judge.me-betyg (stjärnor + snitt + antal) att visa PRECIS vid
// köpknappen. Data kommer från temat (Shopifys reviews.rating / rating_count-
// metafält som Judge.me fyller i) via URL-param → shopContextStore. Visas bara
// när det finns minst ett omdöme.
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  rating: number;
  count: number;
  className?: string;
}

export function ReviewBadge({ rating, count, className }: Props) {
  if (!count || count < 1) return null;
  const filled = Math.round(rating);
  return (
    <div className={cn("flex items-center justify-center gap-1.5 py-1 text-sm", className)}>
      <span className="flex items-center gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star
            key={i}
            className={cn(
              "h-4 w-4",
              i < filled ? "fill-amber-400 text-amber-400" : "fill-none text-muted-foreground/40",
            )}
          />
        ))}
      </span>
      <span className="font-semibold">{rating.toFixed(1).replace(".", ",")}</span>
      <span className="text-muted-foreground">({count})</span>
    </div>
  );
}
