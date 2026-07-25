import { Suspense, useMemo, useRef, useState, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { Loader2, AlertCircle } from "lucide-react";
import { CANVAS_BLEED_CM, canvasWrapExtCm } from "@/lib/gelato-geometry";

interface Canvas3DPreviewProps {
  printUrl: string | null;
  loading: boolean;
  error?: string;
  /** Visible front dimensions in cm (what customer ordered). */
  widthCm: number;
  heightCm: number;
  /** Canvas depth in cm (2 = slim, 4 = thick). */
  depthCm: number;
  /** Wrap-zonens bredd per sida i tryckfilen (djup + baksidesvik). */
  wrapExtCm?: number;
  /** Bleed per sida utanför wrap-zonen (Gelato canvas = 1.5). */
  bleedCm?: number;
  /**
   * När true: rendera bara själva 3D-canvasen utan yttre sektion/rubrik
   * (för användning inuti en dialog/lightbox).
   */
  embedded?: boolean;
}

/** Shared cache so each thumbnail doesn't re-download the same texture. */
function useTexture(url: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) { setTex(null); return; }
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(url, (t) => {
      if (cancelled) return;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      setTex(t);
    });
    return () => { cancelled = true; };
  }, [url]);
  return tex;
}

/**
 * Canvas mesh med Gelato-verklig konstruktion:
 *
 * Tryckfilen (renderTemplateSnapshot med wrapCm + bleedCm) är upplagd som
 *   [ bleed | wrap | FRONT | wrap | bleed ]   (per axel, wrap = djup + vik)
 *
 * Framsidan samplar front-zonen, sidorna samplar DJUP-delen av wrap-zonen,
 * och baksidans vikta kanter samplar fortsättningen (speglad — precis som
 * duken viks IRL). Baksidan är IHÅLIG: träspännram runt kanten, dukens
 * baksida synlig i den försänkta mitten.
 */
function CanvasMesh({
  texture, widthCm, heightCm, depthCm, wrapExtCm, bleedCm,
}: {
  texture: THREE.Texture;
  widthCm: number; heightCm: number; depthCm: number; wrapExtCm: number; bleedCm: number;
}) {
  const maxCm = Math.max(widthCm, heightCm);
  const u = (cm: number) => (cm / maxCm) * 2; // cm → scenenheter
  const w = u(widthCm);
  const h = u(heightCm);
  const d = u(depthCm);
  // Synlig vikbredd på baksidan (det som finns kvar av wrap + bleed).
  const foldCm = Math.min(2.2, Math.max(1.2, wrapExtCm - depthCm + bleedCm));
  const foldU = u(foldCm);

  const { boxMaterials, foldMats } = useMemo(() => {
    // Texturlayout-fraktioner per axel
    const totalW = widthCm + 2 * (wrapExtCm + bleedCm);
    const totalH = heightCm + 2 * (wrapExtCm + bleedCm);
    const fx = (cm: number) => cm / totalW;
    const fy = (cm: number) => cm / totalH;
    const frontX0 = fx(bleedCm + wrapExtCm);
    const frontY0 = fy(bleedCm + wrapExtCm);
    const fFrontX = fx(widthCm);
    const fFrontY = fy(heightCm);
    const fDepthX = fx(depthCm);
    const fDepthY = fy(depthCm);
    const fFoldX = fx(foldCm);
    const fFoldY = fy(foldCm);

    // Klona texturen till ett UV-fönster (top-left-origo in, UV-origo ut).
    const make = (
      offsetX: number, offsetY: number,
      repeatX: number, repeatY: number,
      flipX = false, flipY = false,
    ) => {
      const t = texture.clone();
      t.needsUpdate = true;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      const uvOffsetX = offsetX;
      const uvOffsetY = 1 - (offsetY + repeatY);
      t.offset.set(
        flipX ? uvOffsetX + repeatX : uvOffsetX,
        flipY ? uvOffsetY + repeatY : uvOffsetY,
      );
      t.repeat.set(flipX ? -repeatX : repeatX, flipY ? -repeatY : repeatY);
      return new THREE.MeshStandardMaterial({
        map: t, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
      });
    };

    // FRONT (+Z)
    const front = make(frontX0, frontY0, fFrontX, fFrontY);
    // Sidor: DJUP-delen av wrap-bandet närmast fronten.
    const right = make(frontX0 + fFrontX, frontY0, fDepthX, fFrontY);
    const left = make(frontX0 - fDepthX, frontY0, fDepthX, fFrontY);
    const top = make(frontX0, frontY0 - fDepthY, fFrontX, fDepthY);
    const bottom = make(frontX0, frontY0 + fFrontY, fFrontX, fDepthY);
    // Baksidan på boxen är osynlig — det ihåliga byggs av egna meshes.
    const back = new THREE.MeshStandardMaterial({ visible: false });

    // Vikta kanter på baksidan: fortsättningen BORTOM djupet, speglad
    // (duken viks runt bakkanten → utsidan vänds mot betraktaren).
    const foldRight = make(frontX0 + fFrontX + fDepthX, frontY0, fFoldX, fFrontY, true, false);
    const foldLeft = make(frontX0 - fDepthX - fFoldX, frontY0, fFoldX, fFrontY, true, false);
    const foldTop = make(frontX0, frontY0 - fDepthY - fFoldY, fFrontX, fFoldY, false, true);
    const foldBottom = make(frontX0, frontY0 + fFrontY + fDepthY, fFrontX, fFoldY, false, true);

    return {
      boxMaterials: [right, left, top, bottom, front, back],
      foldMats: { foldRight, foldLeft, foldTop, foldBottom },
    };
  }, [texture, widthCm, heightCm, depthCm, wrapExtCm, bleedCm, foldCm]);

  // Spännram (trä) + dukbaksida
  const woodMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d9c8a4", roughness: 0.9 }), []);
  const woodMatDark = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c9b892", roughness: 0.9 }), []);
  const fabricBack = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ece7db", roughness: 1 }), []);

  const barU = Math.min(u(3.5), Math.min(w, h) * 0.24); // ~3,5 cm breda lister
  const barD = d * 0.86;
  const inset = 0.012;
  const zBack = -d / 2;

  return (
    <group>
      {/* Duken: front + 4 sidor (baksidan osynlig) */}
      <mesh castShadow receiveShadow material={boxMaterials}>
        <boxGeometry args={[w, h, d]} />
      </mesh>

      {/* Dukens baksida, försänkt ända in vid frontens insida */}
      <mesh position={[0, 0, d / 2 - 0.006]} rotation={[0, Math.PI, 0]} material={fabricBack}>
        <planeGeometry args={[w - inset, h - inset]} />
      </mesh>

      {/* Spännram: topp/botten + vänster/höger (stumfog som IRL) */}
      <mesh position={[0, h / 2 - barU / 2 - inset / 2, 0]} material={woodMat}>
        <boxGeometry args={[w - 2 * inset, barU, barD]} />
      </mesh>
      <mesh position={[0, -(h / 2 - barU / 2 - inset / 2), 0]} material={woodMat}>
        <boxGeometry args={[w - 2 * inset, barU, barD]} />
      </mesh>
      <mesh position={[w / 2 - barU / 2 - inset / 2, 0, 0]} material={woodMatDark}>
        <boxGeometry args={[barU, h - 2 * inset - 2 * barU, barD]} />
      </mesh>
      <mesh position={[-(w / 2 - barU / 2 - inset / 2), 0, 0]} material={woodMatDark}>
        <boxGeometry args={[barU, h - 2 * inset - 2 * barU, barD]} />
      </mesh>

      {/* Vikta dukkanter på baksidan (hörnen lämnas fria = kapade veck) */}
      <mesh position={[w / 2 - foldU / 2, 0, zBack - 0.003]} rotation={[0, Math.PI, 0]} material={foldMats.foldRight}>
        <planeGeometry args={[foldU, h - 2 * foldU]} />
      </mesh>
      <mesh position={[-(w / 2 - foldU / 2), 0, zBack - 0.003]} rotation={[0, Math.PI, 0]} material={foldMats.foldLeft}>
        <planeGeometry args={[foldU, h - 2 * foldU]} />
      </mesh>
      <mesh position={[0, h / 2 - foldU / 2, zBack - 0.003]} rotation={[0, Math.PI, 0]} material={foldMats.foldTop}>
        <planeGeometry args={[w - 2 * foldU, foldU]} />
      </mesh>
      <mesh position={[0, -(h / 2 - foldU / 2), zBack - 0.003]} rotation={[0, Math.PI, 0]} material={foldMats.foldBottom}>
        <planeGeometry args={[w - 2 * foldU, foldU]} />
      </mesh>
    </group>
  );
}

function Scene({
  printUrl, widthCm, heightCm, depthCm, wrapExtCm, bleedCm,
}: {
  printUrl: string;
  widthCm: number; heightCm: number; depthCm: number; wrapExtCm: number; bleedCm: number;
}) {
  const tex = useTexture(printUrl);
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[3, 4, 5]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-3, 2, 2]} intensity={0.3} />
      {/* Svagt bakljus så spännramen läses när man roterar runt */}
      <directionalLight position={[0, 2, -4]} intensity={0.45} />
      {tex && (
        <CanvasMesh
          texture={tex}
          widthCm={widthCm}
          heightCm={heightCm}
          depthCm={depthCm}
          wrapExtCm={wrapExtCm}
          bleedCm={bleedCm}
        />
      )}
      <ContactShadows position={[0, -1.4, 0]} opacity={0.35} scale={6} blur={2.4} far={2} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        minPolarAngle={Math.PI / 2 - Math.PI / 4}
        maxPolarAngle={Math.PI / 2 + Math.PI / 4}
      />
    </>
  );
}

export function Canvas3DPreview({
  printUrl, loading, error, widthCm, heightCm, depthCm,
  wrapExtCm, bleedCm = CANVAS_BLEED_CM, embedded = false,
}: Canvas3DPreviewProps) {
  const wrapExt = wrapExtCm ?? canvasWrapExtCm(depthCm);
  const inner = (
    <div
      className="w-full rounded-2xl overflow-hidden bg-card border relative"
      style={{ height: embedded ? "min(75vh, 640px)" : "min(60vh, 520px)" }}
    >
      {loading || !printUrl ? (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/40 animate-pulse">
          {error ? (
            <div className="flex flex-col items-center text-destructive text-xs p-4 text-center gap-2">
              <AlertCircle className="h-5 w-5" />
              <span className="line-clamp-3">{error}</span>
            </div>
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
        </div>
      ) : (
        <Canvas
          shadows
          dpr={[1, 2]}
          camera={{ position: [0, 0, 3.6], fov: 35 }}
          gl={{ preserveDrawingBuffer: false, antialias: true }}
        >
          <color attach="background" args={["#f5f2ec"]} />
          <Suspense fallback={null}>
            <Scene
              printUrl={printUrl}
              widthCm={widthCm}
              heightCm={heightCm}
              depthCm={depthCm}
              wrapExtCm={wrapExt}
              bleedCm={bleedCm}
            />
          </Suspense>
        </Canvas>
      )}
      <div className="absolute bottom-2 right-3 text-[11px] text-muted-foreground bg-background/80 backdrop-blur-sm px-2 py-1 rounded-full pointer-events-none">
        dra för att rotera — även runt baksidan
      </div>
    </div>
  );

  if (embedded) return inner;

  return (
    <div className="border-t bg-[hsl(var(--paper))]">
      <div className="px-4 py-3">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          3D-förhandsvisning
        </h3>
        {inner}
      </div>
    </div>
  );
}
