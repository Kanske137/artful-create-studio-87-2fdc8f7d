// Diagonalt upprepat "Arthena"-vattenmärke ovanpå ETT bildlager i editorns
// förhandsvisning (foto / AI-bild / statisk bild). Renderas absolut över
// lagrets yta och klipps till lagrets form via `clipPath`. Endast visuellt
// (pointer-events: none) — pan/zoom/drag på lagret fungerar opåverkat.
// Vattenmärket ligger BARA i DOM:en: tryckfilen renderas separat via
// template-snapshot och innehåller det aldrig.
//
// SVG-pattern med två textnoder i förskjutet "tegelmönster" ger de diagonala
// raderna; vit fyllning + mörk kantlinje syns på både ljusa och mörka motiv.
import { useId } from "react";

export function WatermarkOverlay({ clipPath }: { clipPath?: string }) {
  const patternId = useId();
  const textStyle: React.CSSProperties = {
    fontFamily: "Inter, sans-serif",
    fontWeight: 600,
    fontSize: 22,
    letterSpacing: "0.06em",
    fill: "rgba(255, 255, 255, 0.4)",
    stroke: "rgba(0, 0, 0, 0.18)",
    strokeWidth: 1.3,
    paintOrder: "stroke",
  };
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none select-none"
      style={{ clipPath }}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width="210"
          height="142"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-30)"
        >
          <text x="8" y="40" style={textStyle}>
            Arthena
          </text>
          <text x="113" y="111" style={textStyle}>
            Arthena
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
