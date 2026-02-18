import { NextResponse } from "next/server";

const GOOGLE_PLACES_API_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const OSM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

type NormalizedResult = {
  id: string;
  name: string;
  address: string;
  source: "google" | "osm";
  lat: number | null;
  lng: number | null;
  rating: number | null;
  review_count: number | null;
  zip_code: string | null;
  census_income: number | null;
};

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;
const incomeCache = new Map<string, number | null>();

function extractZip(address: string): string | null {
  const m = String(address || "").match(ZIP_RE);
  return m?.[1] || null;
}

async function fetchCensusIncome(zipCode: string): Promise<number | null> {
  if (!zipCode) return null;
  if (incomeCache.has(zipCode)) return incomeCache.get(zipCode) ?? null;

  try {
    const endpoint = `https://api.census.gov/data/2023/acs/acs5?get=B19013_001E&for=zip%20code%20tabulation%20area:${encodeURIComponent(
      zipCode
    )}`;
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) {
      incomeCache.set(zipCode, null);
      return null;
    }

    const body = await res.json();
    const value = Array.isArray(body) && Array.isArray(body[1]) ? Number(body[1][0]) : NaN;
    const income = Number.isFinite(value) ? value : null;
    incomeCache.set(zipCode, income);
    return income;
  } catch {
    incomeCache.set(zipCode, null);
    return null;
  }
}

async function attachCensusIncome(rows: NormalizedResult[]): Promise<NormalizedResult[]> {
  if (!rows.length) return rows;
  const uniqueZips = [...new Set(rows.map((r) => r.zip_code).filter(Boolean) as string[])];
  if (!uniqueZips.length) return rows;

  await Promise.all(uniqueZips.map((zip) => fetchCensusIncome(zip)));
  return rows.map((row) => ({
    ...row,
    census_income: row.zip_code ? incomeCache.get(row.zip_code) ?? null : null,
  }));
}

function isGenericStoreName(name: string): boolean {
  const n = String(name || "").trim().toLowerCase();
  return !n || n === "thrift store" || n === "thrift shop" || n === "store";
}

function deriveOsmName(row: any, index: number): string {
  const direct = String(row?.name || "").trim();
  if (!isGenericStoreName(direct)) return direct;

  const parts = String(row?.display_name || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const neighborhood = parts[2] || parts[1] || parts[0] || `Area ${index + 1}`;
  return `${neighborhood} Thrift Store`;
}

async function searchGooglePlaces(query: string, limit: number): Promise<NormalizedResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];
  const queryVariants = [
    `thrift stores in ${query}`,
    `Goodwill in ${query}`,
    `Salvation Army thrift in ${query}`,
    `vintage clothing store in ${query}`,
  ];
  const all: NormalizedResult[] = [];
  const seen = new Set<string>();

  for (const variant of queryVariants) {
    const endpoint = `${GOOGLE_PLACES_API_URL}?query=${encodeURIComponent(
      variant
    )}&key=${encodeURIComponent(apiKey)}`;

    const res = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const body = await res.json();
    if (!res.ok || body?.status === "REQUEST_DENIED" || body?.status === "OVER_QUERY_LIMIT") {
      continue;
    }

    const results = Array.isArray(body?.results) ? body.results : [];
    for (const r of results) {
      const id = String(r.place_id || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      all.push({
        id,
        name: String(r.name || r.formatted_address?.split(",")[0] || "Store"),
        address: String(r.formatted_address || "Address unavailable"),
        source: "google",
        lat: Number.isFinite(Number(r?.geometry?.location?.lat)) ? Number(r.geometry.location.lat) : null,
        lng: Number.isFinite(Number(r?.geometry?.location?.lng)) ? Number(r.geometry.location.lng) : null,
        rating: Number.isFinite(Number(r?.rating)) ? Number(r.rating) : null,
        review_count: Number.isFinite(Number(r?.user_ratings_total)) ? Number(r.user_ratings_total) : null,
        zip_code: extractZip(String(r.formatted_address || "")),
        census_income: null,
      });
      if (all.length >= limit) break;
    }
    if (all.length >= limit) break;
  }

  return all.slice(0, limit);
}

async function searchOsm(query: string, limit: number): Promise<NormalizedResult[]> {
  const endpoint = `${OSM_SEARCH_URL}?format=jsonv2&limit=${limit}&q=${encodeURIComponent(
    `thrift store ${query}`
  )}`;
  const res = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "User-Agent": "thriftpulse/1.0 (store-search)",
    },
    cache: "no-store",
  });
  if (!res.ok) return [];

  const body = await res.json();
  const results = Array.isArray(body) ? body : [];
  return results.slice(0, limit).map((r: any, i: number) => ({
    id: String(r.place_id || `osm-${i}`),
    name: deriveOsmName(r, i),
    address: String(r.display_name || "Address unavailable"),
    source: "osm",
    lat: Number.isFinite(Number(r?.lat)) ? Number(r.lat) : null,
    lng: Number.isFinite(Number(r?.lon)) ? Number(r.lon) : null,
    rating: null,
    review_count: null,
    zip_code: extractZip(String(r.display_name || "")),
    census_income: null,
  }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const rawLimit = Number(searchParams.get("limit") || 20);
  const limit = Math.max(1, Math.min(30, Number.isFinite(rawLimit) ? rawLimit : 20));

  if (!q) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }

  try {
    const googleResults = await searchGooglePlaces(q, limit);
    const osmResults =
      googleResults.length < limit ? await searchOsm(q, limit - googleResults.length) : [];

    const merged = [...googleResults, ...osmResults];
    const seen = new Set<string>();
    const deduped: NormalizedResult[] = [];
    for (const row of merged) {
      const key = `${row.name.toLowerCase()}|${row.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
      if (deduped.length >= limit) break;
    }

    const enriched = await attachCensusIncome(deduped);

    return NextResponse.json({
      results: enriched,
      source: googleResults.length > 0 ? (osmResults.length > 0 ? "google+osm" : "google") : osmResults.length > 0 ? "osm" : "none",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "places_search_exception", details: err?.message || "unknown_error" },
      { status: 502 }
    );
  }
}
