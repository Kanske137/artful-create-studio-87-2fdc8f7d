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

/**
 * Procedurella material för baksidan — byggda efter Gelatos egen produktbild
 * av canvasbaksidan (canvas-back.webp): blek furu med synlig ådring,
 * vävd dukbaksida med kantskugga, häftklamrar längs viken och vikta hörn.
 */
function makeWoodTexture(vertical: boolean): THREE.CanvasTexture {
  const W = vertical ? 128 : 512;
  const H = vertical ? 512 : 128;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  const grad = vertical ? g.createLinearGradient(0, 0, W, 0) : g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#ead9b6");
  grad.addColorStop(0.5, "#e2d0a8");
  grad.addColorStop(1, "#e7d6b2");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // Ådring längs listens längdriktning (deterministisk pseudo-slump)
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const streaks = 26;
  for (let i = 0; i < streaks; i++) {
    const pos = (i + 0.2 + rnd() * 0.6) / streaks;
    const alpha = 0.05 + rnd() * 0.11;
    const width = 0.6 + rnd() * 1.8;
    const wave = 3 + rnd() * 5;
    g.strokeStyle = `rgba(168,140,96,${alpha.toFixed(3)})`;
    g.lineWidth = width;
    g.beginPath();
    const len = vertical ? H : W;
    for (let t = 0; t <= len; t += 16) {
      const off = Math.sin((t / len) * Math.PI * (1.5 + rnd()) + i) * wave;
      const main = pos * (vertical ? W : H) + off;
      if (vertical) { t === 0 ? g.moveTo(main, t) : g.lineTo(main, t); }
      else { t === 0 ? g.moveTo(t, main) : g.lineTo(t, main); }
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeFabricTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ece6d8";
  g.fillRect(0, 0, S, S);
  // Vävstruktur: fina korsande trådar
  g.globalAlpha = 0.05;
  g.strokeStyle = "#9a917e";
  g.lineWidth = 1;
  for (let x = 0; x < S; x += 3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  for (let y = 0; y < S; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  g.globalAlpha = 1;
  // Kantskugga in mot spännramen (steget syns i Gelatos foto)
  const edge = g.createLinearGradient(0, 0, 0, 40);
  edge.addColorStop(0, "rgba(0,0,0,0.16)");
  edge.addColorStop(1, "rgba(0,0,0,0)");
  for (let r = 0; r < 4; r++) {
    g.save();
    g.translate(S / 2, S / 2);
    g.rotate((r * Math.PI) / 2);
    g.translate(-S / 2, -S / 2);
    g.fillStyle = edge;
    g.fillRect(0, 0, S, 40);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Klammerremsa (transparent) att lägga ovanpå vikbandet. */
function makeStapleTexture(count: number, vertical: boolean): THREE.CanvasTexture {
  const L = 512, T = 64;
  const c = document.createElement("canvas");
  c.width = vertical ? T : L;
  c.height = vertical ? L : T;
  const g = c.getContext("2d")!;
  let seed = 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const pos = ((i + 0.5) / count) * L + (rnd() - 0.5) * 20;
    const mid = T / 2 + (rnd() - 0.5) * 8;
    const ang = (rnd() - 0.5) * 0.14;
    g.save();
    if (vertical) { g.translate(mid, pos); g.rotate(Math.PI / 2 + ang); }
    else { g.translate(pos, mid); g.rotate(ang); }
    // Klammer: platt silverbygel med mörk kontur + skugga
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(-11, -2.5, 24, 7);
    g.fillStyle = "#c3c7cb";
    g.fillRect(-12, -3.5, 24, 6);
    g.strokeStyle = "#7e8286";
    g.lineWidth = 1.4;
    g.strokeRect(-12, -3.5, 24, 6);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillRect(-12, -3.5, 24, 1.6);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Transparent veck-overlay för hörnfliken: mjuk diagonal skugga + highlight
 * ("\" i texturrymden; roteras per hörn så vecket går ytterhörn → innerhörn)
 * och en klammer tvärs över vecket — som i Gelatos foto.
 */
function makeCornerCreaseTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  // Skugg-/highlightband vinkelrätt mot diagonalen (0,0)→(S,S)
  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(Math.PI / 4);
  const band = g.createLinearGradient(0, -14, 0, 14);
  band.addColorStop(0, "rgba(0,0,0,0)");
  band.addColorStop(0.38, "rgba(0,0,0,0.13)");
  band.addColorStop(0.5, "rgba(0,0,0,0.02)");
  band.addColorStop(0.62, "rgba(255,255,255,0.14)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = band;
  g.fillRect(-S, -14, 2 * S, 28);
  // Tunn vecklinje
  g.strokeStyle = "rgba(80,72,58,0.28)";
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(-S * 0.65, 0);
  g.lineTo(S * 0.65, 0);
  g.stroke();
  // Klammer tvärs över vecket
  g.rotate(Math.PI / 2);
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(-10, -2, 22, 6);
  g.fillStyle = "#c3c7cb";
  g.fillRect(-11, -3, 22, 5.5);
  g.strokeStyle = "#7e8286";
  g.lineWidth = 1.3;
  g.strokeRect(-11, -3, 22, 5.5);
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.fillRect(-11, -3, 22, 1.4);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
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

  const { boxMaterials, foldMats, cornerMats } = useMemo(() => {
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
    const X1 = frontX0 + fFrontX + fDepthX;
    const Xl = frontX0 - fDepthX - fFoldX;
    const Yt = frontY0 - fDepthY - fFoldY;
    const Yb = frontY0 + fFrontY + fDepthY;
    const foldRight = make(X1, frontY0, fFoldX, fFrontY, true, false);
    const foldLeft = make(Xl, frontY0, fFoldX, fFrontY, true, false);
    const foldTop = make(frontX0, Yt, fFrontX, fFoldY, false, true);
    const foldBottom = make(frontX0, Yb, fFrontX, fFoldY, false, true);
    // Hörnflikarnas bas = tryckets EGET hörninnehåll (dubbelspeglat) så de
    // smälter ihop färgmässigt med båda angränsande vikband.
    const cornTR = make(X1, Yt, fFoldX, fFoldY, true, true);
    const cornTL = make(Xl, Yt, fFoldX, fFoldY, true, true);
    const cornBR = make(X1, Yb, fFoldX, fFoldY, true, true);
    const cornBL = make(Xl, Yb, fFoldX, fFoldY, true, true);

    return {
      boxMaterials: [right, left, top, bottom, front, back],
      foldMats: { foldRight, foldLeft, foldTop, foldBottom },
      cornerMats: { cornTR, cornTL, cornBR, cornBL },
    };
  }, [texture, widthCm, heightCm, depthCm, wrapExtCm, bleedCm, foldCm]);

  // Spännram + baksida — material byggda efter Gelatos produktfoto.
  const woodMatH = useMemo(() => new THREE.MeshStandardMaterial({ map: makeWoodTexture(false), roughness: 0.9 }), []);
  const woodMatV = useMemo(() => new THREE.MeshStandardMaterial({ map: makeWoodTexture(true), roughness: 0.9 }), []);
  const fabricBack = useMemo(() => new THREE.MeshStandardMaterial({ map: makeFabricTexture(), roughness: 1 }), []);
  const creaseMat = useMemo(() => {
    const t = makeCornerCreaseTexture();
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  }, []);
  const stapleMatH = useMemo(() => {
    const t = makeStapleTexture(3, false);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  }, []);
  const stapleMatV = useMemo(() => {
    const t = makeStapleTexture(3, true);
    return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  }, []);

  const barU = Math.min(u(3.5), Math.min(w, h) * 0.24); // ~3,5 cm breda lister
  const barD = d * 0.9;
  const zBack = -d / 2;
  // Listerna flush mot bakplanet så viken ligger an mot träet (som IRL).
  const barZ = zBack + barD / 2 + 0.004;
  // Listerna dras in bakom vikbandet: från flacka sidovinklar träffar blicken
  // då dukbaksidan (tyg) i stället för trä — och bakifrån börjar träet precis
  // vid vikens innerkant, som i Gelatos foto.
  const barGap = foldU * 0.9;

  return (
    <group>
      {/* Duken: front + 4 sidor (baksidan osynlig) */}
      <mesh castShadow receiveShadow material={boxMaterials}>
        <boxGeometry args={[w, h, d]} />
      </mesh>

      {/* Dukens baksida, försänkt ända in vid frontens insida */}
      <mesh position={[0, 0, d / 2 - 0.006]} rotation={[0, Math.PI, 0]} material={fabricBack}>
        <planeGeometry args={[w - 0.006, h - 0.006]} />
      </mesh>

      {/* Tygfoder innanför väggarna: blockerar trä-genomsyn vid flacka vinklar
          (enkelsidiga, vända MOT väggen — osynliga från baksidan/kant-i-kant) */}
      <mesh position={[-w / 2 + 0.003, 0, 0]} rotation={[0, -Math.PI / 2, 0]} material={fabricBack}>
        <planeGeometry args={[d, h]} />
      </mesh>
      <mesh position={[w / 2 - 0.003, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={fabricBack}>
        <planeGeometry args={[d, h]} />
      </mesh>
      <mesh position={[0, h / 2 - 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} material={fabricBack}>
        <planeGeometry args={[w, d]} />
      </mesh>
      <mesh position={[0, -h / 2 + 0.003, 0]} rotation={[Math.PI / 2, 0, 0]} material={fabricBack}>
        <planeGeometry args={[w, d]} />
      </mesh>

      {/* Spännram: topp/botten + vänster/höger, ådring längs listen */}
      <mesh position={[0, h / 2 - barGap - barU / 2, barZ]} material={woodMatH}>
        <boxGeometry args={[w - 2 * barGap, barU, barD]} />
      </mesh>
      <mesh position={[0, -(h / 2 - barGap - barU / 2), barZ]} material={woodMatH}>
        <boxGeometry args={[w - 2 * barGap, barU, barD]} />
      </mesh>
      <mesh position={[w / 2 - barGap - barU / 2, 0, barZ]} material={woodMatV}>
        <boxGeometry args={[barU, h - 2 * barGap - 2 * barU, barD]} />
      </mesh>
      <mesh position={[-(w / 2 - barGap - barU / 2), 0, barZ]} material={woodMatV}>
        <boxGeometry args={[barU, h - 2 * barGap - 2 * barU, barD]} />
      </mesh>

      {/* Vikta dukkanter på baksidan (tryckets fortsättning, speglad) */}
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

      {/* Häftklamrar längs vikbanden */}
      <mesh position={[w / 2 - foldU / 2, 0, zBack - 0.006]} rotation={[0, Math.PI, 0]} material={stapleMatV}>
        <planeGeometry args={[foldU, h - 2 * foldU]} />
      </mesh>
      <mesh position={[-(w / 2 - foldU / 2), 0, zBack - 0.006]} rotation={[0, Math.PI, 0]} material={stapleMatV}>
        <planeGeometry args={[foldU, h - 2 * foldU]} />
      </mesh>
      <mesh position={[0, h / 2 - foldU / 2, zBack - 0.006]} rotation={[0, Math.PI, 0]} material={stapleMatH}>
        <planeGeometry args={[w - 2 * foldU, foldU]} />
      </mesh>
      <mesh position={[0, -(h / 2 - foldU / 2), zBack - 0.006]} rotation={[0, Math.PI, 0]} material={stapleMatH}>
        <planeGeometry args={[w - 2 * foldU, foldU]} />
      </mesh>

      {/* Diagonalt vikta hörnflikar: bas = tryckets hörninnehåll (smälter
          ihop med vikbanden) + veck-overlay roterad så vecket alltid går
          från ytterhörnet in mot mitten, med klammer — som Gelatos hörnvik. */}
      {([
        { x: w / 2 - foldU / 2, y: h / 2 - foldU / 2, mat: cornerMats.cornTR, rz: 0 },
        { x: -(w / 2 - foldU / 2), y: h / 2 - foldU / 2, mat: cornerMats.cornTL, rz: Math.PI / 2 },
        { x: w / 2 - foldU / 2, y: -(h / 2 - foldU / 2), mat: cornerMats.cornBR, rz: Math.PI / 2 },
        { x: -(w / 2 - foldU / 2), y: -(h / 2 - foldU / 2), mat: cornerMats.cornBL, rz: 0 },
      ]).map((c, i) => (
        <group key={i}>
          <mesh position={[c.x, c.y, zBack - 0.0045]} rotation={[0, Math.PI, 0]} material={c.mat}>
            <planeGeometry args={[foldU, foldU]} />
          </mesh>
          <mesh position={[c.x, c.y, zBack - 0.0075]} rotation={[0, Math.PI, c.rz]} material={creaseMat}>
            <planeGeometry args={[foldU, foldU]} />
          </mesh>
        </group>
      ))}
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
