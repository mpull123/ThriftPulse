import type { StyleProfile, StyleProfileStatus } from "@/lib/types";

export type StyleGuidanceState = "ok" | "needs_generation" | "failed";
export type StyleItemType = StyleProfile["item_type"];

const STYLE_ITEM_TYPES: StyleItemType[] = [
  "outerwear",
  "bottoms",
  "footwear",
  "knitwear",
  "bags",
  "dress",
  "top",
  "mixed",
];

const STYLE_NOUNS_BY_TYPE: Record<StyleItemType, string[]> = {
  outerwear: ["jacket", "coat", "anorak", "parka", "blazer", "trench", "windbreaker", "shell"],
  bottoms: ["pants", "jeans", "trousers", "cargo", "chino", "skirt", "shorts", "culotte"],
  footwear: ["boots", "boot", "sneakers", "sneaker", "shoe", "shoes", "loafer", "loafers", "clog"],
  knitwear: ["hoodie", "sweater", "cardigan", "knit", "crewneck", "sweatshirt"],
  bags: ["bag", "tote", "crossbody", "handbag", "backpack", "satchel", "messenger"],
  dress: ["dress", "maxi", "midi", "slip dress", "gown"],
  top: ["shirt", "tee", "t-shirt", "top", "blouse", "tank"],
  mixed: [],
};

const MAINSTREAM_BRANDS = [
  "converse",
  "adidas",
  "nike",
  "new balance",
  "vans",
  "reebok",
  "dr martens",
  "timberland",
  "carhartt",
  "levi's",
  "levis",
  "patagonia",
  "the north face",
  "north face",
  "coach",
  "sorel",
  "salomon",
  "puma",
];

const GENERIC_PATTERNS: RegExp[] = [
  /\bprioriti[sz]e clean condition\b/i,
  /\bquality construction\b/i,
  /\bstrong construction\b/i,
  /\bcondition and quality\b/i,
  /\bmatch the core silhouette first\b/i,
  /\bbefore brand hunting\b/i,
  /\btrend hype\b/i,
  /\bclean condition over hype\b/i,
];

const STYLE_CUE_KEYWORDS = [
  "cropped",
  "oversized",
  "wide-leg",
  "high-rise",
  "high-waisted",
  "straight leg",
  "chunky",
  "platform",
  "colorblock",
  "90s",
  "vintage",
  "distressed",
  "washed",
  "raw hem",
  "mid-rise",
  "belted",
  "double knee",
  "chelsea",
  "tabi",
  "lug sole",
  "east-west",
  "hobo",
  "crossbody",
  "mini",
  "maxi",
  "midi",
  "cargo",
  "pleated",
  "straight fit",
];

function compactWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLine(value: unknown): string {
  return compactWhitespace(String(value || ""))
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[.]{2,}/g, ".")
    .trim();
}

function normalizeForCompare(value: string): string {
  return compactWhitespace(String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

function tokenize(value: string): string[] {
  return normalizeForCompare(value)
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length > 2);
}

export function isNearDuplicateLine(a: string, b: string): boolean {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (aTokens.size === 0 || bTokens.size === 0) return false;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.max(aTokens.size, bTokens.size) >= 0.65;
}

function inferItemTypesFromLine(line: string): Set<StyleItemType> {
  const normalized = normalizeForCompare(line);
  const hits = new Set<StyleItemType>();
  for (const itemType of STYLE_ITEM_TYPES) {
    if (itemType === "mixed") continue;
    const nouns = STYLE_NOUNS_BY_TYPE[itemType];
    if (nouns.some((noun) => normalized.includes(noun))) hits.add(itemType);
  }
  return hits;
}

export function inferStyleItemTypeFromTitle(title: string): StyleItemType {
  const types = inferItemTypesFromLine(title);
  if (types.has("outerwear")) return "outerwear";
  if (types.has("footwear")) return "footwear";
  if (types.has("dress")) return "dress";
  if (types.has("knitwear")) return "knitwear";
  if (types.has("bags")) return "bags";
  if (types.has("bottoms")) return "bottoms";
  if (types.has("top")) return "top";
  return "mixed";
}

function isLineCompatibleWithTitleType(line: string, titleType: StyleItemType): boolean {
  if (titleType === "mixed") return true;
  const lineTypes = inferItemTypesFromLine(line);
  if (lineTypes.size === 0) return true;
  if (lineTypes.has(titleType)) return true;
  return false;
}

function hasUsefulCue(line: string): boolean {
  const normalized = normalizeForCompare(line);
  return STYLE_CUE_KEYWORDS.some((cue) => normalized.includes(cue)) || inferItemTypesFromLine(line).size > 0;
}

function looksTitleMirror(line: string, title: string): boolean {
  const a = normalizeForCompare(line);
  const b = normalizeForCompare(title);
  if (!a || !b) return false;
  if (a === b) return true;
  if (!a.includes(b)) return false;
  const extra = a.replace(b, "").trim();
  const extraWords = extra.split(" ").filter(Boolean);
  return extraWords.length <= 2;
}

function looksGenericLine(line: string, title: string, allowGeneric: boolean): boolean {
  if (allowGeneric) return false;
  const normalized = compactWhitespace(line);
  if (!normalized) return true;
  if (looksTitleMirror(normalized, title)) return true;
  if (GENERIC_PATTERNS.some((p) => p.test(normalized))) return true;
  if (!hasUsefulCue(normalized)) return true;
  return false;
}

function countMainstreamBrands(line: string): number {
  const normalized = normalizeForCompare(line);
  return MAINSTREAM_BRANDS.filter((brand) => normalized.includes(normalizeForCompare(brand))).length;
}

function normalizeList(
  value: unknown,
  maxItems: number,
  options: { title: string; titleType: StyleItemType; allowGeneric?: boolean }
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const line = normalizeLine(raw);
    if (!line || line.length < 6 || line.length > 120) continue;
    if (!isLineCompatibleWithTitleType(line, options.titleType)) continue;
    if (looksGenericLine(line, options.title, Boolean(options.allowGeneric))) continue;
    if (out.some((existing) => isNearDuplicateLine(existing, line))) continue;
    out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
}

function dedupeAcrossSections(profile: StyleProfile): StyleProfile {
  const sections: Array<keyof StyleProfile> = [
    "styles_to_find",
    "find_these_first",
    "where_to_check_first",
    "pass_if",
  ];
  const seen: string[] = [];
  const next: StyleProfile = {
    ...profile,
    styles_to_find: [],
    find_these_first: [],
    where_to_check_first: [],
    pass_if: [],
    confidence_note: profile.confidence_note || "",
  };
  for (const section of sections) {
    const items = Array.isArray(profile[section]) ? (profile[section] as string[]) : [];
    for (const item of items) {
      if (seen.some((existing) => isNearDuplicateLine(existing, item))) continue;
      (next[section] as string[]).push(item);
      seen.push(item);
    }
  }
  next.styles_to_find = next.styles_to_find.slice(0, 3);
  next.find_these_first = next.find_these_first.slice(0, 3);
  next.where_to_check_first = next.where_to_check_first.slice(0, 2);
  next.pass_if = next.pass_if.slice(0, 2);
  return next;
}

function enforceBrandExampleCap(profile: StyleProfile, title: string): StyleProfile {
  const titleNorm = normalizeForCompare(title);
  const titleHasBrand = MAINSTREAM_BRANDS.some((brand) =>
    titleNorm.includes(normalizeForCompare(brand))
  );
  const allowedBrandLines = titleHasBrand ? 1 : 2;
  let consumed = 0;

  const process = (items: string[]): string[] =>
    items.filter((line) => {
      const brandHits = countMainstreamBrands(line);
      if (brandHits === 0) return true;
      if (consumed >= allowedBrandLines) return false;
      consumed += 1;
      return true;
    });

  return {
    ...profile,
    styles_to_find: process(profile.styles_to_find).slice(0, 3),
    find_these_first: process(profile.find_these_first).slice(0, 3),
    where_to_check_first: process(profile.where_to_check_first).slice(0, 2),
    pass_if: process(profile.pass_if).slice(0, 2),
  };
}

type NormalizeResult =
  | { ok: true; profile: StyleProfile }
  | { ok: false; error: string };

export function normalizeStyleProfilePayload(payload: unknown, title: string): NormalizeResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "style_profile_payload_missing" };
  }
  const titleType = inferStyleItemTypeFromTitle(title);
  const typed = payload as Partial<StyleProfile>;

  const normalized: StyleProfile = {
    item_type: STYLE_ITEM_TYPES.includes(typed.item_type as StyleItemType)
      ? (typed.item_type as StyleItemType)
      : titleType,
    styles_to_find: normalizeList(typed.styles_to_find, 3, { title, titleType }),
    find_these_first: normalizeList(typed.find_these_first, 3, { title, titleType }),
    where_to_check_first: normalizeList(typed.where_to_check_first, 2, {
      title,
      titleType,
      allowGeneric: false,
    }),
    pass_if: normalizeList(typed.pass_if, 2, {
      title,
      titleType,
      allowGeneric: false,
    }),
    confidence_note: compactWhitespace(String(typed.confidence_note || "")).slice(0, 140),
  };

  const deduped = enforceBrandExampleCap(dedupeAcrossSections(normalized), title);
  const hasRequired =
    deduped.styles_to_find.length > 0 &&
    deduped.find_these_first.length > 0 &&
    deduped.where_to_check_first.length > 0 &&
    deduped.pass_if.length > 0;
  if (!hasRequired) return { ok: false, error: "style_profile_required_sections_missing" };
  return { ok: true, profile: deduped };
}

function normalizeStatus(status: unknown): StyleProfileStatus | "missing" {
  const value = compactWhitespace(String(status || "")).toLowerCase();
  if (value === "ok" || value === "invalid" || value === "missing" || value === "error") {
    return value;
  }
  return "missing";
}

function parseProfileUnknown(raw: unknown): unknown {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

export function shouldRefreshStyleProfile(
  signal: {
    style_profile_status?: string | null;
    style_profile_json?: unknown;
    style_profile_updated_at?: string | null;
    trend_name?: string | null;
  },
  ttlDays = 14
): boolean {
  const status = normalizeStatus(signal?.style_profile_status);
  if (!signal?.style_profile_json) return true;
  if (status !== "ok") return true;

  const payload = parseProfileUnknown(signal?.style_profile_json);
  const normalized = normalizeStyleProfilePayload(payload, String(signal?.trend_name || ""));
  if (!normalized.ok) return true;

  const updatedAt = String(signal?.style_profile_updated_at || "");
  if (!updatedAt) return true;
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ttlMs = Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
  return !Number.isFinite(ageMs) || ageMs > ttlMs;
}

export function parseStyleProfileFromNode(node: {
  name?: string | null;
  trend_name?: string | null;
  style_profile_status?: string | null;
  style_profile_json?: unknown;
  style_profile_error?: string | null;
}): {
  ok: boolean;
  state: StyleGuidanceState;
  status: StyleProfileStatus | "missing";
  reason: string;
  profile: StyleProfile | null;
} {
  const title = String(node?.name || node?.trend_name || "").trim();
  const status = normalizeStatus(node?.style_profile_status);
  const error = compactWhitespace(String(node?.style_profile_error || ""));
  const payload = parseProfileUnknown(node?.style_profile_json);
  const normalized = normalizeStyleProfilePayload(payload, title);

  if (status === "ok" && normalized.ok) {
    return { ok: true, state: "ok", status: "ok", reason: "", profile: normalized.profile };
  }

  const failedOnDemand = status === "error" && /on_demand/i.test(error);
  if (normalized.ok && status !== "error") {
    return { ok: true, state: "ok", status: "ok", reason: "", profile: normalized.profile };
  }
  if (failedOnDemand) {
    return {
      ok: false,
      state: "failed",
      status,
      reason: error || "On-demand style guidance generation failed.",
      profile: null,
    };
  }
  return {
    ok: false,
    state: "needs_generation",
    status,
    reason: error || "Style guidance has not been generated for this node yet.",
    profile: null,
  };
}

export function isStyleLikeTrack(track: string | null | undefined): boolean {
  const value = compactWhitespace(String(track || "")).toLowerCase();
  if (!value) return true;
  if (value.includes("style")) return true;
  if (value.includes("brand + style")) return true;
  return false;
}
