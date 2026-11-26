/**
 * "Redigera design" från kundvagnen (Se din design, del 2).
 *
 * Flöde:
 * 1. Vid "Lägg i varukorg" sparas hela editorläget i webbläsarens
 *    localStorage under radens _design_id, och raden får egenskapen
 *    _edit_snapshot = "1".
 * 2. Kundvagnen (temat) visar "Redigera design" för rader med
 *    _edit_snapshot och länkar till produktsidan med
 *    ?edit=<design_id>&line=<radnyckel>. Temat skickar edit-id:t vidare
 *    till editorn i iframe-adressen.
 * 3. Editorn läser designen härifrån och återställer den. När kunden lägger
 *    i varukorgen igen skickas replaceLine: true och temat tar bort den
 *    gamla raden efter att den nya lagts till.
 *
 * Varför localStorage: Shopify-kundvagnen lever i samma webbläsare
 * (cookie), så designen behöver bara finnas där kundvagnen finns. Kundens
 * foton laddas upp till print-files eftersom blob-adresser inte överlever en
 * sidladdning; designen pekar på dem med URL. Saknas något (rensad
 * webbläsare, annan enhet) visas ingen redigera-länk eller så meddelar
 * editorn att designen inte kunde öppnas, och raden i kundvagnen lämnas orörd.
 */
import type {
  AiPhotoSource,
  EditorState,
  MultiFacePortrait,
  PhotoLayerSource,
} from "@/stores/editorStore";
import { useEditorStore } from "@/stores/editorStore";
import { useRaceStore } from "@/stores/raceStore";
import { uploadPrintFileBlob } from "@/lib/upload-preview";

const KEY_PREFIX = "arthena.design.";
const INDEX_KEY = "arthena.design.index";
const MAX_SNAPSHOTS = 12;
const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_UPLOAD_BYTES = 14 * 1024 * 1024; // print-files tillåter 15 MB
const MAX_JPEG_EDGE = 6000;

/** Design-id från kundvagnen: UUID (eller editorns reservformat). */
const DESIGN_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export function editDesignIdFrom(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return DESIGN_ID_RE.test(v) ? v : null;
}

interface StoredFile {
  url: string;
  name: string;
  type: string;
  hash: string | null;
}

type SnapshotState = Pick<
  EditorState,
  | "layoutId"
  | "contentVariantId"
  | "layerValues"
  | "layerTransforms"
  | "whiteMarginEnabled"
  | "posterBgColor"
  | "size"
  | "variant"
  | "orientation"
  | "hiddenLayerIds"
  | "template"
  | "photoAiResults"
  | "aiPhotoResults"
  | "aiPhotoSelectedRefUrl"
> &
  // Valfria: saknas i designer sparade före sporttavlorna.
  Partial<Pick<EditorState, "textStash" | "manualSumIds">>;

type RaceSnapshot = Pick<
  ReturnType<typeof useRaceStore.getState>,
  "source" | "raceId" | "courseYear" | "route" | "splits" | "fields" | "show" | "routeColor"
>;

export interface DesignSnapshot {
  v: 1;
  savedAt: number;
  /** Sidans produkt (config.shopify_handle) och material vid sparandet. */
  handle: string;
  productType: string;
  state: SnapshotState;
  photos: Record<string, StoredFile & { originalUrl: string | null }>;
  aiPhotos: Record<string, StoredFile>;
  multiFace: Record<string, Record<string, StoredFile>>;
  race: RaceSnapshot | null;
}

// ---------- uppladdning av kundens foton ----------

/** Redan uppladdade filer i den här sessionen (hash/fil → URL), så att en
 *  redigerad design inte laddar upp samma foto igen. */
const uploaded = new Map<string, string>();

function fileKey(file: File, hash: string | null): string {
  return hash ?? `${file.name}|${file.size}|${file.lastModified}`;
}

async function toJpeg(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_JPEG_EDGE ? MAX_JPEG_EDGE / longest : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D ctx unavailable");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.92),
  );
}

async function ensureUploaded(file: File, hash: string | null, knownUrl: string | null): Promise<string> {
  if (knownUrl && /^https:\/\//.test(knownUrl)) return knownUrl;
  const key = fileKey(file, hash);
  const hit = uploaded.get(key);
  if (hit) return hit;
  const blob: Blob =
    UPLOAD_TYPES.includes(file.type) && file.size <= MAX_UPLOAD_BYTES ? file : await toJpeg(file);
  const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
  const safeHash = (hash ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
  const id = `edit-${safeHash || crypto.randomUUID?.() || Date.now()}`;
  const url = await uploadPrintFileBlob(blob, id, ext);
  uploaded.set(key, url);
  return url;
}

function stored(file: File, hash: string | null, url: string): StoredFile {
  return { url, name: file.name || "photo.jpg", type: file.type || "image/jpeg", hash };
}

// ---------- localStorage ----------

function readIndex(): Array<{ id: string; t: number }> {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string") : [];
  } catch {
    return [];
  }
}

function writeIndex(list: Array<{ id: string; t: number }>) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    /* index är bara för gallring */
  }
}

function writeLocal(designId: string, json: string): boolean {
  const index = readIndex().filter((x) => x.id !== designId);
  // Äldsta först ut tills det får plats (max MAX_SNAPSHOTS sparade designer).
  while (index.length >= MAX_SNAPSHOTS) {
    const old = index.shift();
    if (old) localStorage.removeItem(KEY_PREFIX + old.id);
  }
  for (;;) {
    try {
      localStorage.setItem(KEY_PREFIX + designId, json);
      index.push({ id: designId, t: Date.now() });
      writeIndex(index);
      return true;
    } catch {
      const old = index.shift();
      if (!old) return false;
      try {
        localStorage.removeItem(KEY_PREFIX + old.id);
      } catch {
        return false;
      }
    }
  }
}

// ---------- publikt API ----------

/** Spara aktuell design under designId. Kastar aldrig; false = ingen
 *  redigera-länk i kundvagnen för den här raden. */
export async function saveDesignSnapshot(designId: string): Promise<boolean> {
  try {
    if (typeof localStorage === "undefined") return false;
    const s = useEditorStore.getState();
    if (!s.config || !s.template) return false;

    const photoJobs = Object.entries(s.photoSources ?? {})
      .filter(([, src]) => !!src?.file)
      .map(async ([id, src]: [string, PhotoLayerSource]) => {
        const url = await ensureUploaded(src.file, src.hash, null);
        return [id, { ...stored(src.file, src.hash, url), originalUrl: src.originalUrl }] as const;
      });
    const aiJobs = Object.entries(s.aiPhotoSources ?? {})
      .filter(([, src]) => !!src?.file)
      .map(async ([id, src]: [string, AiPhotoSource]) => {
        const url = await ensureUploaded(src.file, src.hash, src.uploadedUrl);
        return [id, stored(src.file, src.hash, url)] as const;
      });
    const multiJobs = Object.entries(s.multiFacePortraits ?? {}).flatMap(([layerId, slots]) =>
      Object.entries(slots ?? {})
        .filter(([, p]) => !!p?.file)
        .map(async ([slotId, p]: [string, MultiFacePortrait]) => {
          const url = await ensureUploaded(p.file, p.hash, p.uploadedUrl);
          return [layerId, slotId, stored(p.file, p.hash, url)] as const;
        }),
    );

    const [photoList, aiList, multiList] = await Promise.all([
      Promise.all(photoJobs),
      Promise.all(aiJobs),
      Promise.all(multiJobs),
    ]);

    const multiFace: DesignSnapshot["multiFace"] = {};
    for (const [layerId, slotId, f] of multiList) {
      (multiFace[layerId] ??= {})[slotId] = f;
    }

    const r = useRaceStore.getState();
    const snap: DesignSnapshot = {
      v: 1,
      savedAt: Date.now(),
      handle: s.config.shopify_handle,
      productType: s.config.product_type,
      state: {
        layoutId: s.layoutId,
        contentVariantId: s.contentVariantId,
        layerValues: s.layerValues,
        layerTransforms: s.layerTransforms,
        whiteMarginEnabled: s.whiteMarginEnabled,
        posterBgColor: s.posterBgColor,
        size: s.size,
        variant: s.variant,
        orientation: s.orientation,
        hiddenLayerIds: s.hiddenLayerIds,
        template: s.template,
        photoAiResults: s.photoAiResults,
        aiPhotoResults: s.aiPhotoResults,
        aiPhotoSelectedRefUrl: s.aiPhotoSelectedRefUrl,
        textStash: s.textStash,
        manualSumIds: s.manualSumIds,
      },
      photos: Object.fromEntries(photoList),
      aiPhotos: Object.fromEntries(aiList),
      multiFace,
      race: r.route
        ? {
            source: r.source,
            raceId: r.raceId,
            courseYear: r.courseYear,
            route: r.route,
            splits: r.splits,
            fields: r.fields,
            show: r.show,
            routeColor: r.routeColor,
          }
        : null,
    };
    return writeLocal(designId, JSON.stringify(snap));
  } catch (err) {
    console.warn("[design-snapshot] kunde inte spara", err);
    return false;
  }
}

export function loadDesignSnapshot(designId: string): DesignSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + designId);
    if (!raw) return null;
    const snap = JSON.parse(raw) as DesignSnapshot;
    return snap && snap.v === 1 && snap.state ? snap : null;
  } catch {
    return null;
  }
}

async function fetchFile(f: StoredFile): Promise<File> {
  const res = await fetch(f.url);
  if (!res.ok) throw new Error(`photo HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], f.name || "photo.jpg", { type: f.type || blob.type || "image/jpeg" });
}

/** Återställ en sparad design i editorn. Kastar om ett foto inte går att
 *  hämta; då ändras ingenting i editorn. */
export async function restoreDesignSnapshot(snap: DesignSnapshot): Promise<void> {
  const photoEntries = await Promise.all(
    Object.entries(snap.photos ?? {}).map(async ([id, f]) => {
      const file = await fetchFile(f);
      uploaded.set(fileKey(file, f.hash), f.url);
      const src: PhotoLayerSource = {
        file,
        previewUrl: URL.createObjectURL(file),
        hash: f.hash,
        originalUrl: f.originalUrl,
      };
      return [id, src] as const;
    }),
  );
  const aiEntries = await Promise.all(
    Object.entries(snap.aiPhotos ?? {}).map(async ([id, f]) => {
      const file = await fetchFile(f);
      const src: AiPhotoSource = {
        file,
        previewUrl: URL.createObjectURL(file),
        hash: f.hash,
        uploadedUrl: f.url,
      };
      return [id, src] as const;
    }),
  );
  const multiEntries = await Promise.all(
    Object.entries(snap.multiFace ?? {}).flatMap(([layerId, slots]) =>
      Object.entries(slots ?? {}).map(async ([slotId, f]) => {
        const file = await fetchFile(f);
        const p: MultiFacePortrait = {
          file,
          previewUrl: URL.createObjectURL(file),
          hash: f.hash,
          uploadedUrl: f.url,
        };
        return [layerId, slotId, p] as const;
      }),
    ),
  );
  const multiFacePortraits: Record<string, Record<string, MultiFacePortrait>> = {};
  for (const [layerId, slotId, p] of multiEntries) {
    (multiFacePortraits[layerId] ??= {})[slotId] = p;
  }

  useEditorStore.getState().restoreDesign({
    ...snap.state,
    photoSources: Object.fromEntries(photoEntries),
    aiPhotoSources: Object.fromEntries(aiEntries),
    multiFacePortraits,
  });

  if (snap.race) {
    useRaceStore.setState((prev) => ({
      ...snap.race!,
      loading: false,
      error: null,
      fitNonce: prev.fitNonce + 1,
    }));
  }
}
