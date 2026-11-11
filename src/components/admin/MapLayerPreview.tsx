// Mini Mapbox static-image preview used inside admin LayerCanvas tiles.
// Clipped to the layer's shape via the shared shape-clip util — heart/star
// keep their natural 1:1 aspect inscribed inside the shortest side, exactly
// like the editor preview and the print snapshot.
import { useMemo } from "react";
import { useMapboxToken } from "@/hooks/useMapboxToken";
import { isBlankMapStyle, mapStyleUrl, parseMapboxStyleUrl } from "@/lib/map-style-catalog";
import { buildShapeClipPath, type ClipShape } from "@/lib/shape-clip";
import type { MapDefaults } from "@/lib/template-schema";

interface Props {
  defaults: MapDefaults;
  width: number; // px hint for the mapbox tile resolution
  height: number;
}

const MAX_PX = 600;

export default function MapLayerPreview({ defaults, width, height }: Props) {
  const { data: token } = useMapboxToken();

  const url = useMemo(() => {
    if (!token) return null;
    const styleUrl = mapStyleUrl(defaults.styleId);
    const parsed = parseMapboxStyleUrl(styleUrl);
    if (!parsed) return null;
    const w = Math.min(MAX_PX, Math.max(120, Math.round(width)));
    const h = Math.min(MAX_PX, Math.max(120, Math.round(height)));
    const [lng, lat] = defaults.center;
    return `https://api.mapbox.com/styles/v1/${parsed.username}/${parsed.styleId}/static/${lng},${lat},${defaults.zoom},0/${w}x${h}@2x?access_token=${token}&logo=false&attribution=false`;
  }, [token, defaults, width, height]);

  const clipPath = buildShapeClipPath(defaults.shape as ClipShape, width, height);

  // Ingen karta (lopptavlans ruttlager): mallens bakgrund syns igenom.
  if (isBlankMapStyle(defaults.styleId) || defaults.routeStyle) {
    return <div className="relative w-full h-full" />;
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {url ? (
        <img
          src={url}
          alt=""
          className="w-full h-full object-cover"
          style={{ clipPath }}
          draggable={false}
        />
      ) : (
        <div
          className="w-full h-full bg-gradient-to-br from-muted to-muted-foreground/30"
          style={{ clipPath }}
        />
      )}
    </div>
  );
}
