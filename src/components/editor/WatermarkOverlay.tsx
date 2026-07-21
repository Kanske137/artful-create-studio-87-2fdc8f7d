// Diagonalt upprepat "Arthena"-vattenmärke ovanpå editorns förhandsvisning.
// Endast visuellt (pointer-events: none) — pan/zoom/drag på lagren under
// fungerar opåverkat. Vattenmärket ligger BARA i DOM:en: tryckfilen renderas
// separat via template-snapshot och innehåller det aldrig.
//
// SVG-pattern med två textnoder i förskjutet "tegelmönster" ger de diagonala
// raderna; vit fyllning + mörk kantlinje syns på både ljusa och mörka motiv.
export function WatermarkOverlay({ zIndex = 60 }: { zIndex?: number }) {
  const textStyle: React.CSSProperties = {
    fontFamily: "Inter, sans-serif",
    fontWeight: 600,
    fontSize: 24,
    letterSpacing: "0.06em",
    fill: "rgba(255, 255, 255, 0.4)",
    stroke: "rgba(0, 0, 0, 0.18)",
    strokeWidth: 1.4,
    paintOrder: "stroke",
  };
  return (
    <svg
      className="absolute inset-0 h-full w-full pointer-events-none select-none"
      style={{ zIndex }}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id="arthena-wm-tile"
          width="230"
          height="156"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-30)"
        >
          <text x="8" y="44" style={textStyle}>
            Arthena
          </text>
          <text x="123" y="122" style={textStyle}>
            Arthena
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#arthena-wm-tile)" />
    </svg>
  );
}
