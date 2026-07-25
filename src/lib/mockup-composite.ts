import type { MockupScene } from "./mockup-scenes";
import { parseSizeCm } from "./mockup-scenes";
import type { Orientation, ProductType } from "./product-config";
import { textureForHex, preloadTexture } from "./frame-textures";
import { drawAcrylicStud, STUD_DIAMETER_CM, STUD_INSET_CM } from "./acrylic-stud";

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild kunde inte laddas: ${src}`));
    img.src = src;
  });
}

interface CompositArgs {
  scene: MockupScene;
  printUrl: string;
  size: string;
  orientation: Orientation;
  productType: ProductType;
  /** Endast canvas: 2 eller 4 (cm). */
  canvasDepthCm?: number;
  /** Hex-färg för ram, eller null för ingen ram (poster). */
  frameColor?: string | null;
  /** Ramens bredd i cm (verklig). Standard 2.5. */
  frameWidthCm?: number;
  /** Hex-färg för posterhängare (trälist topp+botten). Aldrig samtidigt som ram. */
  hangerColor?: string | null;
}

export async function compositeMockup({
  scene,
  printUrl,
  size,
  orientation,
  productType,
  canvasDepthCm = 2,
  frameColor = null,
  frameWidthCm = 2.5,
  hangerColor = null,
}: CompositArgs): Promise<string> {
  const sizeCm = parseSizeCm(size);
  if (!sizeCm) throw new Error(`Ogiltig storlek: ${size}`);

  const realWcm = orientation === "landscape" ? sizeCm.hCm : sizeCm.wCm;
  const realHcm = orientation === "landscape" ? sizeCm.wCm : sizeCm.hCm;

  const [bg, fg] = await Promise.all([
    loadImage(scene.src, false),
    loadImage(printUrl, true),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = bg.naturalWidth;
  canvas.height = bg.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Kunde inte skapa 2D-context");

  const sceneBase = 1024;
  const sx = bg.naturalWidth / sceneBase;
  const sy = bg.naturalHeight / sceneBase;
  const area = {
    x: scene.area.x * sx,
    y: scene.area.y * sy,
    w: scene.area.w * sx,
    h: scene.area.h * sy,
  };

  // 1. Bakgrund
  ctx.drawImage(bg, 0, 0);

  // 2. Poster-pixelstorlek inom area (skala efter referensbredd → trovärdig storlek)
  let posterW = (realWcm / scene.referenceWidthCm) * area.w;
  let posterH = posterW * (realHcm / realWcm);

  const frameWpx = frameColor && productType !== "canvas"
    ? (frameWidthCm / scene.referenceWidthCm) * area.w
    : 0;

  const totalW = posterW + frameWpx * 2;
  const totalH = posterH + frameWpx * 2;
  if (totalH > area.h) {
    const s = area.h / totalH;
    posterH *= s; posterW *= s;
  }
  if (totalW > area.w) {
    const s = area.w / totalW;
    posterW *= s; posterH *= s;
  }

  const innerW = posterW;
  const innerH = posterH;
  const outerW = innerW + frameWpx * 2;
  const outerH = innerH + frameWpx * 2;

  // Canvas-djup i scenpixlar
  const depthPx = productType === "canvas"
    ? (canvasDepthCm / scene.referenceWidthCm) * area.w
    : 0;
  const angle = scene.canvasWrap ? (scene.canvasWrap.angleDeg * Math.PI) / 180 : 0;
  const sideVisibleW = productType === "canvas" ? depthPx * Math.sin(angle) : 0;
  const topVisibleH = productType === "canvas" ? depthPx * Math.cos(angle) * 0.35 : 0;

  // Total bounding för canvas = front + synlig sida + synlig topp
  const canvasOuterW = posterW + sideVisibleW;
  const canvasOuterH = posterH + topVisibleH;

  // Centrera enheten i area
  const ox = productType === "canvas"
    ? area.x + (area.w - canvasOuterW) / 2
    : area.x + (area.w - outerW) / 2;
  const oy = productType === "canvas"
    ? area.y + (area.h - canvasOuterH) / 2
    : area.y + (area.h - outerH) / 2;
  const px = productType === "canvas" ? ox : ox + frameWpx;
  const py = productType === "canvas" ? oy + topVisibleH : oy + frameWpx;

  // 3. Skugga
  if (scene.shadow) {
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowColor = `rgba(0,0,0,${scene.shadow.alpha})`;
    ctx.shadowBlur = scene.shadow.blur;
    ctx.shadowOffsetY = scene.shadow.offsetY;
    if (productType === "canvas") {
      ctx.fillRect(ox, oy, canvasOuterW, canvasOuterH);
    } else {
      ctx.fillRect(ox, oy, outerW, outerH);
    }
    ctx.restore();
  }

  // 4. Canvas: rita TOPP-wrap (sampla översta ~3% av bilden, sträck över top-trapets)
  if (productType === "canvas" && scene.canvasWrap && topVisibleH > 0.5) {
    const stripSrcH = Math.max(2, fg.naturalHeight * 0.03);
    ctx.save();
    // trapets ovanför postern: vänster topp = (px, py - topVisibleH), höger topp = (px+posterW+sideVisibleW, py-topVisibleH+sideTopOffset)
    // approximation via clip + drawImage skewed
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + posterW, py);
    ctx.lineTo(px + posterW + sideVisibleW, py - topVisibleH);
    ctx.lineTo(px + sideVisibleW * 0.15, py - topVisibleH);
    ctx.closePath();
    ctx.clip();
    // skew så pixlar pressas in mot bakåt-perspektivet
    const skewX = sideVisibleW / Math.max(topVisibleH, 1);
    ctx.transform(1, 0, -skewX * 0.5, 1, 0, 0);
    ctx.drawImage(
      fg,
      0, 0, fg.naturalWidth, stripSrcH,
      px + py * skewX * 0.5, py - topVisibleH, posterW + sideVisibleW, topVisibleH,
    );
    // mörkning bakåt (gradient)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const topGrad = ctx.createLinearGradient(0, py - topVisibleH, 0, py);
    topGrad.addColorStop(0, "rgba(0,0,0,0.35)");
    topGrad.addColorStop(1, "rgba(0,0,0,0.05)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(px - 5, py - topVisibleH, posterW + sideVisibleW + 10, topVisibleH + 1);
    ctx.restore();
  }

  // 5. Canvas: rita HÖGER SIDO-wrap (sampla högra ~3% av bilden, sträck över sido-trapets)
  if (productType === "canvas" && scene.canvasWrap && sideVisibleW > 0.5) {
    const stripSrcW = Math.max(2, fg.naturalWidth * 0.03);
    ctx.save();
    // sido-trapets: vänster-topp=(px+posterW, py), höger-topp=(px+posterW+sideVisibleW, py-topVisibleH),
    //                höger-bot=(px+posterW+sideVisibleW, py+posterH-topVisibleH*0.4), vänster-bot=(px+posterW, py+posterH)
    ctx.beginPath();
    ctx.moveTo(px + posterW, py);
    ctx.lineTo(px + posterW + sideVisibleW, py - topVisibleH);
    ctx.lineTo(px + posterW + sideVisibleW, py + posterH - topVisibleH * 0.4);
    ctx.lineTo(px + posterW, py + posterH);
    ctx.closePath();
    ctx.clip();
    // approximera perspektiv via horisontell sträckning av högra strippan
    const skewY = -topVisibleH / Math.max(sideVisibleW, 1);
    ctx.transform(1, skewY * 0.5, 0, 1, 0, 0);
    ctx.drawImage(
      fg,
      fg.naturalWidth - stripSrcW, 0, stripSrcW, fg.naturalHeight,
      px + posterW, py - (px + posterW) * skewY * 0.5, sideVisibleW, posterH,
    );
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // mörkare gradient mot bakkanten (höger)
    const sideGrad = ctx.createLinearGradient(px + posterW, 0, px + posterW + sideVisibleW, 0);
    sideGrad.addColorStop(0, "rgba(0,0,0,0.05)");
    sideGrad.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = sideGrad;
    ctx.fillRect(px + posterW, py - topVisibleH, sideVisibleW + 1, posterH + topVisibleH);
    ctx.restore();
  }

  // 6. Ram (endast poster med vald färg) — mitred corners + trätextur
  if (frameColor && frameWpx > 0 && productType !== "canvas") {
    const texUrl = textureForHex(frameColor);
    let texImg: HTMLImageElement | null = null;
    if (texUrl) {
      try { texImg = await preloadTexture(texUrl); } catch { texImg = null; }
    }

    // Drop shadow behind frame
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = frameWpx * 1.2;
    ctx.shadowOffsetY = frameWpx * 0.4;
    ctx.fillStyle = "rgba(0,0,0,0.001)"; // shape carrier
    ctx.fillRect(ox, oy, outerW, outerH);
    ctx.restore();

    const drawSide = (
      poly: Array<[number, number]>,
      tex: HTMLImageElement | null,
      rotate: boolean,
      stripW: number,
      stripH: number,
      px0: number,
      py0: number,
    ) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(poly[0][0], poly[0][1]);
      for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
      ctx.closePath();
      ctx.clip();
      if (tex) {
        if (rotate) {
          // Side: rotate 90° so grain runs along the list length.
          ctx.translate(px0 + stripW, py0);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(tex, 0, 0, stripH, stripW);
        } else {
          ctx.drawImage(tex, px0, py0, stripW, stripH);
        }
      } else {
        ctx.fillStyle = frameColor;
        ctx.fillRect(px0, py0, stripW, stripH);
      }
      ctx.restore();
    };

    // Top
    drawSide(
      [[ox, oy], [ox + outerW, oy], [ox + outerW - frameWpx, oy + frameWpx], [ox + frameWpx, oy + frameWpx]],
      texImg, false, outerW, frameWpx, ox, oy,
    );
    // Bottom
    drawSide(
      [[ox + frameWpx, oy + outerH - frameWpx], [ox + outerW - frameWpx, oy + outerH - frameWpx], [ox + outerW, oy + outerH], [ox, oy + outerH]],
      texImg, false, outerW, frameWpx, ox, oy + outerH - frameWpx,
    );
    // Left
    drawSide(
      [[ox, oy], [ox + frameWpx, oy + frameWpx], [ox + frameWpx, oy + outerH - frameWpx], [ox, oy + outerH]],
      texImg, true, frameWpx, outerH, ox, oy,
    );
    // Right
    drawSide(
      [[ox + outerW - frameWpx, oy + frameWpx], [ox + outerW, oy], [ox + outerW, oy + outerH], [ox + outerW - frameWpx, oy + outerH - frameWpx]],
      texImg, true, frameWpx, outerH, ox + outerW - frameWpx, oy,
    );

    // 45° highlight/shadow overlay across the whole frame for depth
    ctx.save();
    const grad = ctx.createLinearGradient(ox, oy, ox + outerW, oy + outerH);
    grad.addColorStop(0, "rgba(255,255,255,0.20)");
    grad.addColorStop(0.5, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.24)");
    ctx.fillStyle = grad;
    // Clip to outer rect minus inner print area so the gradient only paints on the frame band
    ctx.beginPath();
    ctx.rect(ox, oy, outerW, outerH);
    ctx.rect(px + innerW, py, -innerW, innerH); // inner cutout (reverse winding)
    ctx.fill("evenodd");
    ctx.restore();

    // Profil i Gelato-klass: yttre kantlinje, mitre-sömmar i hörnen och en
    // fasad innerläpp (highlight + steg) — det som skiljer en "platt remsa"
    // från en riktig ramprofil.
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(1, frameWpx * 0.05);
    ctx.strokeRect(ox + 0.5, oy + 0.5, outerW - 1, outerH - 1);

    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + frameWpx, oy + frameWpx);
    ctx.moveTo(ox + outerW, oy);
    ctx.lineTo(ox + outerW - frameWpx, oy + frameWpx);
    ctx.moveTo(ox, oy + outerH);
    ctx.lineTo(ox + frameWpx, oy + outerH - frameWpx);
    ctx.moveTo(ox + outerW, oy + outerH);
    ctx.lineTo(ox + outerW - frameWpx, oy + outerH - frameWpx);
    ctx.stroke();
    ctx.restore();

    const lip = Math.max(1, frameWpx * 0.14);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1, lip * 0.6);
    ctx.strokeRect(px - lip * 0.7, py - lip * 0.7, innerW + lip * 1.4, innerH + lip * 1.4);

    // Inner rim shadow where print meets frame
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = Math.max(1, frameWpx * 0.08);
    ctx.strokeRect(px - 0.5, py - 0.5, innerW + 1, innerH + 1);
  }

  // 7. Front: postern själv — RAKT, ingen skew (innehåll ska aldrig förvrängas)
  ctx.drawImage(fg, px, py, posterW, posterH);

  // 7b. Inramad poster: ramens innerskugga faller på trycket (topp+vänster)
  // och glaset ger en diskret diagonal reflex — utan detta ser ramen
  // "pålagd" ut i stället för att trycket sitter I den.
  if (frameColor && frameWpx > 0 && productType !== "canvas") {
    const inset = frameWpx * 0.9;
    const shTop = ctx.createLinearGradient(0, py, 0, py + inset);
    shTop.addColorStop(0, "rgba(0,0,0,0.22)");
    shTop.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shTop;
    ctx.fillRect(px, py, innerW, inset);
    const shLeft = ctx.createLinearGradient(px, 0, px + inset, 0);
    shLeft.addColorStop(0, "rgba(0,0,0,0.16)");
    shLeft.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shLeft;
    ctx.fillRect(px, py, inset, innerH);

    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, innerW, innerH);
    ctx.clip();
    const glass = ctx.createLinearGradient(px, py, px + innerW, py + innerH);
    glass.addColorStop(0, "rgba(255,255,255,0)");
    glass.addColorStop(0.42, "rgba(255,255,255,0)");
    glass.addColorStop(0.5, "rgba(255,255,255,0.07)");
    glass.addColorStop(0.58, "rgba(255,255,255,0)");
    glass.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glass;
    ctx.fillRect(px, py, innerW, innerH);
    ctx.restore();
  }

  // 8. Diskret skugga i hörnen för att binda postern mot väggen
  if (productType !== "canvas") {
    ctx.save();
    const cornerGrad = ctx.createRadialGradient(
      px + posterW / 2, py + posterH / 2, posterW * 0.4,
      px + posterW / 2, py + posterH / 2, posterW * 0.7,
    );
    cornerGrad.addColorStop(0, "rgba(0,0,0,0)");
    cornerGrad.addColorStop(1, "rgba(0,0,0,0.08)");
    ctx.fillStyle = cornerGrad;
    ctx.fillRect(px, py, posterW, posterH);
    ctx.restore();
  }

  // 8b. Akryl/plexiglas: glansig yta, kantglöd (materialtjocklek) och fyra
  // metalldistanser i hörnen — matchar Gelatos produktrendering.
  if (productType === "acrylic") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, posterW, posterH);
    ctx.clip();
    const gloss = ctx.createLinearGradient(px, py, px + posterW, py + posterH);
    gloss.addColorStop(0, "rgba(255,255,255,0.14)");
    gloss.addColorStop(0.25, "rgba(255,255,255,0.02)");
    gloss.addColorStop(0.45, "rgba(255,255,255,0.10)");
    gloss.addColorStop(0.6, "rgba(255,255,255,0)");
    gloss.addColorStop(1, "rgba(255,255,255,0.04)");
    ctx.fillStyle = gloss;
    ctx.fillRect(px, py, posterW, posterH);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1.5, posterW * 0.004);
    ctx.strokeRect(px + 0.75, py + 0.75, posterW - 1.5, posterH - 1.5);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(px - 0.5, py - 0.5, posterW + 1, posterH + 1);

    // Fysisk skala som Gelato: cap ~18 mm, centrum ~26 mm från kant.
    const studR = Math.max(3, ((STUD_DIAMETER_CM / 2) / realWcm) * posterW);
    const insetS = Math.max(studR * 1.6, (STUD_INSET_CM / realWcm) * posterW);
    drawAcrylicStud(ctx, px + insetS, py + insetS, studR);
    drawAcrylicStud(ctx, px + posterW - insetS, py + insetS, studR);
    drawAcrylicStud(ctx, px + insetS, py + posterH - insetS, studR);
    drawAcrylicStud(ctx, px + posterW - insetS, py + posterH - insetS, studR);
  }

  // 9. Posterhängare (trälist topp+botten + snöre)
  if (hangerColor && productType === "posters") {
    const slatH = Math.max(3, (2.1 / scene.referenceWidthCm) * area.w);
    const overhang = slatH * 0.15;
    const cordRiseCm = Math.min(6, Math.max(2.5, realHcm * 0.06));
    const cordRise = (cordRiseCm / scene.referenceWidthCm) * area.w;
    const x0 = px - overhang;
    const x1 = px + posterW + overhang;

    const hangTexUrl = textureForHex(hangerColor);
    let hangTex: HTMLImageElement | null = null;
    if (hangTexUrl) {
      try { hangTex = await preloadTexture(hangTexUrl); } catch { hangTex = null; }
    }

    const drawSlat = (yTop: number) => {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = slatH * 0.5;
      ctx.shadowOffsetY = slatH * 0.2;
      if (hangTex) {
        ctx.drawImage(hangTex, x0, yTop, x1 - x0, slatH);
      } else {
        ctx.fillStyle = hangerColor;
        ctx.fillRect(x0, yTop, x1 - x0, slatH);
      }
      ctx.restore();
      const grad = ctx.createLinearGradient(0, yTop, 0, yTop + slatH);
      grad.addColorStop(0, "rgba(255,255,255,0.22)");
      grad.addColorStop(0.5, "rgba(255,255,255,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = grad;
      ctx.fillRect(x0, yTop, x1 - x0, slatH);
      // Ändträ-kapsyler + markerad underkant ger listen tjocklek — utan dem
      // ser den ut som en platt målad remsa i stället för en trälist.
      const cap = Math.max(1, slatH * 0.12);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(x0, yTop, cap, slatH);
      ctx.fillRect(x1 - cap, yTop, cap, slatH);
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(x0, yTop + slatH - Math.max(1, slatH * 0.1), x1 - x0, Math.max(1, slatH * 0.1));
      if (hangerColor.toLowerCase() === "#f5f5f2") {
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, yTop + 0.5, x1 - x0 - 1, slatH - 1);
      }
    };
    // Listerna sitter OVANPÅ motivets översta/nedersta 21 mm — matchar
    // Gelatos faktiska produkt (21mm trälist på posterns front).
    const topSlatY = py;
    const botSlatY = py + posterH - slatH;
    drawSlat(topSlatY);
    drawSlat(botSlatY);

    // Triangulärt snöre (spik), fäst på topp-listens ÖVERKANT nära ytterkanterna.
    const slatWidth = x1 - x0;
    const anchorInset = slatWidth * 0.06;
    const cordLeftX = x0 + anchorInset;
    const cordRightX = x1 - anchorInset;
    const cordBaseY = topSlatY; // listens överkant
    const cordPeakY = topSlatY - cordRise;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cordLeftX, cordBaseY);
    ctx.lineTo((cordLeftX + cordRightX) / 2, cordPeakY);
    ctx.lineTo(cordRightX, cordBaseY);
    // Tunnare lädersnöre + fästpunkter — tjockt snöre läser som "ritat".
    ctx.lineWidth = Math.max(1.2, slatH * 0.14);
    ctx.strokeStyle = "rgba(55,42,30,0.9)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    // Små knutar vid fästena
    ctx.fillStyle = "rgba(45,34,24,0.95)";
    const knotR = Math.max(1.2, slatH * 0.16);
    ctx.beginPath();
    ctx.arc(cordLeftX, cordBaseY, knotR, 0, Math.PI * 2);
    ctx.arc(cordRightX, cordBaseY, knotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}
