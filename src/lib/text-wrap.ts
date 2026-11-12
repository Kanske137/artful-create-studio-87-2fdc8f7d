// Radbrytning för tryckfilens textlager.
//
// Editorns förhandsvisning (TextLayerView) bryter text automatiskt med
// `white-space: pre-wrap; word-break: break-word`. Canvas gör det inte, så en
// lång rubrik som visas på två rader i editorn hamnade på en enda rad i
// tryckfilen och kunde gå utanför sin ruta. Den här funktionen bryter raderna
// på samma sätt: vid mellanslag, och inom ett ord bara när ordet ensamt inte
// får plats. Mellanslag vid en mjuk radbrytning hänger kvar (räknas inte).

export interface WrapPiece {
  text: string;
}

/**
 * Bryter `lines` (rader av textbitar med egen stil) så att ingen rad blir
 * bredare än `maxWidth`. `measure(piece, text)` ger bredden för `text` i
 * bitens stil. Hårda radbrytningar (redan separata rader) behålls.
 */
export function wrapPieceLines<P extends WrapPiece>(
  lines: P[][],
  measure: (piece: P, text: string) => number,
  maxWidth: number,
): P[][] {
  if (!(maxWidth > 0)) return lines;
  const out: P[][] = [];
  for (const line of lines) {
    const total = line.reduce((w, p) => w + measure(p, p.text), 0);
    if (total <= maxWidth) {
      out.push(line);
      continue;
    }
    // Ord och mellanslag som egna bitar, med originalbitens stil.
    const tokens: Array<{ piece: P; text: string; space: boolean; w: number }> = [];
    for (const p of line) {
      for (const t of p.text.split(/( +)/)) {
        if (!t) continue;
        tokens.push({ piece: p, text: t, space: t.startsWith(" "), w: measure(p, t) });
      }
    }

    let cur: Array<{ piece: P; text: string }> = [];
    let curW = 0;
    let pendingSpace: { piece: P; text: string; w: number } | null = null;
    const flush = () => {
      out.push(mergeTokens(cur));
      cur = [];
      curW = 0;
      pendingSpace = null;
    };

    for (const tok of tokens) {
      if (tok.space) {
        // Mellanslag läggs bara till om ett ord följer på samma rad.
        if (cur.length > 0) pendingSpace = tok;
        continue;
      }
      const spaceW = pendingSpace ? pendingSpace.w : 0;
      if (cur.length > 0 && curW + spaceW + tok.w > maxWidth) flush();
      if (pendingSpace && cur.length > 0) {
        cur.push({ piece: pendingSpace.piece, text: pendingSpace.text });
        curW += pendingSpace.w;
      }
      pendingSpace = null;

      if (curW + tok.w <= maxWidth) {
        cur.push({ piece: tok.piece, text: tok.text });
        curW += tok.w;
        continue;
      }
      // Ordet får inte plats ens på en tom rad: bryt inom ordet.
      let rest = tok.text;
      while (rest.length > 0) {
        let n = 1;
        while (n < rest.length && curW + measure(tok.piece, rest.slice(0, n + 1)) <= maxWidth) n++;
        const part = rest.slice(0, n);
        cur.push({ piece: tok.piece, text: part });
        curW += measure(tok.piece, part);
        rest = rest.slice(n);
        if (rest.length > 0) flush();
      }
    }
    if (cur.length > 0 || out.length === 0) flush();
  }
  return out;
}

/** Slår ihop intilliggande bitar med samma stil (samma källbit). */
function mergeTokens<P extends WrapPiece>(tokens: Array<{ piece: P; text: string }>): P[] {
  const merged: P[] = [];
  let last: { src: P; out: P } | null = null;
  for (const t of tokens) {
    if (last && last.src === t.piece) {
      last.out.text += t.text;
    } else {
      const out = { ...t.piece, text: t.text };
      merged.push(out);
      last = { src: t.piece, out };
    }
  }
  return merged;
}
