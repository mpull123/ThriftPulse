"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Crosshair,
  Map as MapIcon,
  MapPin,
  Navigation,
  Plus,
  Search,
  Target,
  Zap,
  Minus,
} from "lucide-react";

const GOOGLE_MAPS_EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY || "";
const GOOGLE_MAPS_JS_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_KEY || "";
const GOOGLE_MAPS_SCRIPT_ID = "thriftpulse-google-maps-js";
const STORE_MAP_SCOPE_STORAGE_KEY = "thriftpulse.storeMap.scope";

declare global {
  interface Window {
    google?: any;
    __thriftpulseGoogleMapsLoader?: Promise<void>;
  }
}

type StoreNode = {
  id: string;
  name: string;
  address: string;
  zip_code?: string;
  power_rank: number;
  rating?: number | null;
  review_count?: number | null;
  census_income?: number | null;
  lat?: number | null;
  lng?: number | null;
  source?: string;
  type: string;
  best_time: string;
  matches: string[];
  coords: { top: string; left: string };
};

type MapScope = "neighborhood" | "city" | "metro";

function isMapScope(value: unknown): value is MapScope {
  return value === "neighborhood" || value === "city" || value === "metro";
}

function loadGoogleMapsJs(apiKey: string): Promise<void> {
  if (!apiKey) return Promise.reject(new Error("missing_google_maps_key"));
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  if (window.google?.maps) return Promise.resolve();
  if (window.__thriftpulseGoogleMapsLoader) return window.__thriftpulseGoogleMapsLoader;

  window.__thriftpulseGoogleMapsLoader = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_MAPS_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("google_maps_script_failed")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_MAPS_SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("google_maps_script_failed"));
    document.head.appendChild(script);
  }).catch((err) => {
    window.__thriftpulseGoogleMapsLoader = undefined;
    throw err;
  });

  return window.__thriftpulseGoogleMapsLoader;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRank(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(Math.round(n), 1, 100) : fallback;
}

function generateFallbackCoords(index: number): { top: string; left: string } {
  const columns = 4;
  const row = Math.floor(index / columns);
  const col = index % columns;
  const top = 18 + row * 14;
  const left = 16 + col * 20;
  return {
    top: `${clamp(top, 10, 88)}%`,
    left: `${clamp(left, 10, 90)}%`,
  };
}

function normalizeStoreRows(stores: any[]): StoreNode[] {
  if (!Array.isArray(stores) || stores.length === 0) return [];

  return stores.map((store, i) => {
    const fallbackRank = clamp(68 + (i % 5) * 6, 1, 100);
    const coords =
      store?.coords && typeof store.coords.top === "string" && typeof store.coords.left === "string"
        ? store.coords
        : generateFallbackCoords(i);

    const baseMatches = Array.isArray(store?.matches) && store.matches.length > 0
      ? store.matches.map((m: string) => String(m || "").trim()).filter(Boolean)
      : ["Jackets", "Denim", "Footwear"];

    return {
      id: String(store?.id ?? `store-${i}`),
      name: String(store?.name || `Thrift Node ${i + 1}`),
      address: String(store?.address || "Address unavailable"),
      zip_code: store?.zip_code ? String(store.zip_code) : undefined,
      power_rank: parseRank(store?.power_rank, fallbackRank),
      rating: parseOptionalNumber(store?.rating),
      review_count: parseOptionalNumber(store?.review_count),
      census_income: parseOptionalNumber(store?.census_income),
      lat: parseOptionalNumber(
        store?.lat ??
          store?.latitude ??
          store?.coords?.lat ??
          store?.location?.lat
      ),
      lng: parseOptionalNumber(
        store?.lng ??
          store?.lon ??
          store?.longitude ??
          store?.coords?.lng ??
          store?.coords?.lon ??
          store?.location?.lng ??
          store?.location?.lon
      ),
      source: store?.source ? String(store.source) : undefined,
      type: String(store?.type || "Thrift Store"),
      best_time: String(store?.best_time || "Weekday mornings"),
      matches: baseMatches,
      coords,
    };
  });
}

function hasGeoPoint(store: Pick<StoreNode, "lat" | "lng">): boolean {
  if (store.lat === null || store.lat === undefined || store.lng === null || store.lng === undefined) {
    return false;
  }
  const lat = Number(store.lat);
  const lng = Number(store.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // Guard against null-coerce bugs rendering a false coordinate in the Atlantic.
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  return true;
}

function normalizeSearchKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",")
    .trim();
}

function buildGeocodeQuery(store: StoreNode, currentLocation: string): string {
  const base = [store.name, store.address].filter(Boolean).join(", ");
  if (!base) return currentLocation || "";
  if (!currentLocation) return base;
  return `${base}, ${currentLocation}`;
}

function projectStoresToCoords(stores: StoreNode[]): Record<string, { top: string; left: string }> {
  if (!stores.length) return {};

  const geoStores = stores.filter(hasGeoPoint);
  if (!geoStores.length) {
    return Object.fromEntries(
      stores.map((store, index) => [store.id, store.coords || generateFallbackCoords(index)])
    );
  }

  const lats = geoStores.map((s) => Number(s.lat));
  const lngs = geoStores.map((s) => Number(s.lng));
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);

  if (maxLat - minLat < 0.02) {
    minLat -= 0.01;
    maxLat += 0.01;
  } else {
    const pad = (maxLat - minLat) * 0.12;
    minLat -= pad;
    maxLat += pad;
  }

  if (maxLng - minLng < 0.02) {
    minLng -= 0.01;
    maxLng += 0.01;
  } else {
    const pad = (maxLng - minLng) * 0.12;
    minLng -= pad;
    maxLng += pad;
  }

  const coordMap: Record<string, { top: string; left: string }> = {};

  stores.forEach((store, index) => {
    if (!hasGeoPoint(store)) {
      coordMap[store.id] = store.coords || generateFallbackCoords(index);
      return;
    }

    const lat = Number(store.lat);
    const lng = Number(store.lng);
    const x = (lng - minLng) / Math.max(maxLng - minLng, 0.0001);
    const y = (maxLat - lat) / Math.max(maxLat - minLat, 0.0001);

    const jitterX = ((index % 3) - 1) * 0.8;
    const jitterY = ((Math.floor(index / 3) % 3) - 1) * 0.8;

    const left = clamp(8 + x * 84 + jitterX, 6, 94);
    const top = clamp(16 + y * 68 + jitterY, 12, 90);

    coordMap[store.id] = { top: `${top}%`, left: `${left}%` };
  });

  return coordMap;
}

function deriveMapCenter(stores: StoreNode[], selectedStore: StoreNode | null): { lat: number; lng: number } | null {
  if (selectedStore && hasGeoPoint(selectedStore)) {
    return { lat: Number(selectedStore.lat), lng: Number(selectedStore.lng) };
  }

  const geoStores = stores.filter(hasGeoPoint);
  if (!geoStores.length) return null;
  const lat = geoStores.reduce((sum, s) => sum + Number(s.lat), 0) / geoStores.length;
  const lng = geoStores.reduce((sum, s) => sum + Number(s.lng), 0) / geoStores.length;
  return { lat, lng };
}

function getGeoBounds(stores: StoreNode[]): { latSpan: number; lngSpan: number } | null {
  const geoStores = stores.filter(hasGeoPoint);
  if (!geoStores.length) return null;
  const lats = geoStores.map((s) => Number(s.lat));
  const lngs = geoStores.map((s) => Number(s.lng));
  return {
    latSpan: Math.max(...lats) - Math.min(...lats),
    lngSpan: Math.max(...lngs) - Math.min(...lngs),
  };
}

function getMapScopeConfig(scope: MapScope): {
  fitLatSpanMax: number;
  fitLngSpanMax: number;
  minZoomAfterFit: number;
  nonSelectedZoomMin: number;
  nonSelectedZoomMax: number;
  cityZoom: number;
  zipZoom: number;
} {
  if (scope === "neighborhood") {
    return {
      fitLatSpanMax: 0.22,
      fitLngSpanMax: 0.32,
      minZoomAfterFit: 13,
      nonSelectedZoomMin: 13,
      nonSelectedZoomMax: 15,
      cityZoom: 13,
      zipZoom: 14,
    };
  }
  if (scope === "metro") {
    return {
      fitLatSpanMax: 0.75,
      fitLngSpanMax: 1.05,
      minZoomAfterFit: 11,
      nonSelectedZoomMin: 10,
      nonSelectedZoomMax: 12,
      cityZoom: 11,
      zipZoom: 12,
    };
  }
  return {
    fitLatSpanMax: 0.45,
    fitLngSpanMax: 0.65,
    minZoomAfterFit: 12,
    nonSelectedZoomMin: 12,
    nonSelectedZoomMax: 14,
    cityZoom: 12,
    zipZoom: 13,
  };
}

function inferDefaultSearchZoom(query: string, scope: MapScope): number {
  const cfg = getMapScopeConfig(scope);
  const q = String(query || "").trim();
  if (!q) return cfg.cityZoom;
  if (/^\d{5}(?:-\d{4})?$/.test(q)) return cfg.zipZoom;
  if (/,\s*[A-Za-z]{2}\b/.test(q)) return cfg.cityZoom;
  return cfg.cityZoom;
}

function fallbackStores(): StoreNode[] {
  return [
    {
      id: "fallback-1",
      name: "Goodwill Bins (Outlet)",
      address: "2300 Cobb Pkwy, Kennesaw",
      power_rank: 98,
      type: "Wholesale / Bins",
      best_time: "Tue Mornings (Restock)",
      matches: ["Vintage", "Carhartt", "Denim"],
      coords: { top: "30%", left: "40%" },
    },
    {
      id: "fallback-2",
      name: "Park Ave Thrift",
      address: "400 Chastain Rd, Marietta",
      power_rank: 85,
      type: "Retail Thrift",
      best_time: "Wednesdays (Sale)",
      matches: ["Ralph Lauren", "Patagonia", "Fleece"],
      coords: { top: "58%", left: "66%" },
    },
    {
      id: "fallback-3",
      name: "Value Village",
      address: "Roswell Rd, Atlanta",
      power_rank: 92,
      type: "Big Box Thrift",
      best_time: "Daily 10AM",
      matches: ["Jackets", "Denim", "Silverware"],
      coords: { top: "44%", left: "20%" },
    },
  ];
}

function matchesStore(item: any, store: StoreNode): boolean {
  const itemText = [
    String(item?.name || ""),
    ...(Array.isArray(item?.what_to_buy) ? item.what_to_buy.map((v: string) => String(v || "")) : []),
    ...(Array.isArray(item?.tags) ? item.tags.map((v: string) => String(v || "")) : []),
  ]
    .join(" ")
    .toLowerCase();

  return store.matches.some((m) => itemText.includes(String(m || "").toLowerCase()));
}

function computePowerRank(row: any, idx: number): number {
  const base = 62 + (20 - idx) * 1.1;
  const rating = Number(row?.rating);
  const reviews = Number(row?.review_count);
  const censusIncome = Number(row?.census_income);

  const ratingBoost = Number.isFinite(rating) ? clamp((rating - 3.5) * 12, -8, 18) : 0;
  const reviewBoost = Number.isFinite(reviews) && reviews > 0 ? clamp(Math.log10(reviews + 1) * 8, 0, 16) : 0;
  const incomeBoost =
    Number.isFinite(censusIncome) && censusIncome > 0
      ? clamp((censusIncome - 65000) / 9000, -6, 12)
      : 0;

  return clamp(Math.round(base + ratingBoost + reviewBoost + incomeBoost), 1, 100);
}

function mapApiResultsToStores(results: any[]): StoreNode[] {
  if (!Array.isArray(results)) return [];
  return results.slice(0, 20).map((row, idx) => ({
    id: String(row.id || row.place_id || `places-${idx}`),
    name: String(row.name || row.formatted_address?.split(",")[0] || row.address?.split(",")[0] || `Store ${idx + 1}`),
    address: String(row.address || row.formatted_address || "Address unavailable"),
    power_rank: computePowerRank(row, idx),
    rating: parseOptionalNumber(row?.rating),
    review_count: parseOptionalNumber(row?.review_count),
    census_income: parseOptionalNumber(row?.census_income),
    lat: parseOptionalNumber(row?.lat),
    lng: parseOptionalNumber(row?.lng),
    source: row?.source ? String(row.source) : undefined,
    type: row.source === "osm" ? "OpenStreetMap" : "Google Places",
    best_time: "Weekday mornings",
    matches: ["Jackets", "Denim", "Footwear"],
    coords: generateFallbackCoords(idx),
  }));
}

export default function SectionHunt({
  location: initialLocation,
  stores = [],
  trunk = [],
  onConfirmFound,
}: any) {
  const [currentLocation, setCurrentLocation] = useState(initialLocation || "30064");
  const [searchInput, setSearchInput] = useState("");
  const [selectedStore, setSelectedStore] = useState<StoreNode | null>(null);
  const [showTopOnly, setShowTopOnly] = useState(false);
  const [detectedStores, setDetectedStores] = useState<StoreNode[]>([]);
  const [mapScope, setMapScope] = useState<MapScope>("city");
  const [mapZoom, setMapZoom] = useState(12);
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<"loading" | "js" | "embed">(
    GOOGLE_MAPS_JS_KEY ? "loading" : "embed"
  );
  const [mapNotice, setMapNotice] = useState<string | null>(null);
  const [geoOverrides, setGeoOverrides] = useState<Record<string, { lat: number; lng: number }>>({});
  const searchCacheRef = useRef<Record<string, StoreNode[]>>({});
  const latestSearchRequestRef = useRef(0);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<any>(null);
  const googleMarkersRef = useRef<any[]>([]);
  const selectedMarkerRef = useRef<any>(null);
  const lastAutoFitKeyRef = useRef<string>("");
  const geocodeAttemptCacheRef = useRef<Map<string, { lat: number; lng: number } | null>>(new Map());
  const geocodeAuthNoticeShownRef = useRef(false);

  const normalizedStoreData = useMemo(() => {
    const normalized = normalizeStoreRows(stores);
    return normalized.length > 0 ? normalized : fallbackStores();
  }, [stores]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedScope = window.localStorage.getItem(STORE_MAP_SCOPE_STORAGE_KEY);
      if (isMapScope(savedScope)) {
        setMapScope(savedScope);
      }
    } catch {
      // localStorage can fail in privacy modes; keep default.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORE_MAP_SCOPE_STORAGE_KEY, mapScope);
    } catch {
      // Ignore storage write failures.
    }
  }, [mapScope]);

  useEffect(() => {
    setDetectedStores(normalizedStoreData);
  }, [normalizedStoreData]);

  useEffect(() => {
    setMapZoom(inferDefaultSearchZoom(currentLocation, mapScope));
  }, [mapScope, currentLocation]);

  useEffect(() => {
    let cancelled = false;
    if (!GOOGLE_MAPS_JS_KEY) {
      setMapMode("embed");
      setMapNotice(null);
      return;
    }

    setMapMode("loading");
    loadGoogleMapsJs(GOOGLE_MAPS_JS_KEY)
      .then(() => {
        if (cancelled) return;
        setMapMode("js");
        setMapNotice(null);
      })
      .catch(() => {
        if (cancelled) return;
        setMapMode("embed");
        setMapNotice("Interactive map unavailable. Using embedded map view.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (mapMode !== "js" || typeof window === "undefined" || !window.google?.maps?.Geocoder) {
      return;
    }

    const missing = detectedStores.filter((store) => !hasGeoPoint(store) && !geoOverrides[store.id]);
    if (!missing.length) return;

    const geocoder = new window.google.maps.Geocoder();

    const run = async () => {
      for (const store of missing.slice(0, 8)) {
        if (cancelled) return;
        const query = buildGeocodeQuery(store, currentLocation);
        const cacheKey = normalizeSearchKey(query);
        const cached = geocodeAttemptCacheRef.current.get(cacheKey);
        if (cached) {
          setGeoOverrides((prev) => (prev[store.id] ? prev : { ...prev, [store.id]: cached }));
          continue;
        }
        if (geocodeAttemptCacheRef.current.has(cacheKey) && cached === null) {
          continue;
        }

        try {
          // Geocoder callback API wrapped in a promise for sequential control.
          const result = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
            geocoder.geocode({ address: query }, (results: any[], status: string) => {
              if (status === "REQUEST_DENIED" && !geocodeAuthNoticeShownRef.current) {
                geocodeAuthNoticeShownRef.current = true;
                setMapNotice(
                  "Map loaded, but address pin placement is limited. Enable Geocoding API for the browser map key."
                );
              }
              if (status !== "OK" || !Array.isArray(results) || !results[0]?.geometry?.location) {
                resolve(null);
                return;
              }
              const loc = results[0].geometry.location;
              const lat = typeof loc.lat === "function" ? Number(loc.lat()) : Number(loc.lat);
              const lng = typeof loc.lng === "function" ? Number(loc.lng()) : Number(loc.lng);
              if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                resolve(null);
                return;
              }
              resolve({ lat, lng });
            });
          });

          if (cancelled) return;
          geocodeAttemptCacheRef.current.set(cacheKey, result);
          if (result) {
            setGeoOverrides((prev) => ({ ...prev, [store.id]: result }));
          }
        } catch {
          geocodeAttemptCacheRef.current.set(cacheKey, null);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [mapMode, detectedStores, geoOverrides, currentLocation]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void (async () => {
      const q = searchInput.trim();
      if (!q) {
        setDetectedStores(normalizedStoreData);
        setSearchNotice(null);
        setMapZoom(inferDefaultSearchZoom(initialLocation || "30064", mapScope));
        return;
      }

      setCurrentLocation(q);
      setSelectedStore(null);
      setSearching(true);
      setSearchNotice(null);
      const normalizedQuery = normalizeSearchKey(q);
      const requestId = ++latestSearchRequestRef.current;

      try {
        const placesRes = await fetch(
          `/api/places-search?q=${encodeURIComponent(q)}&limit=20`,
          {
            headers: { Accept: "application/json" },
          }
        );
        if (placesRes.ok) {
          const placesData = await placesRes.json();
          const mappedResults = mapApiResultsToStores(placesData?.results || []);
          if (mappedResults.length > 0) {
            const cached = searchCacheRef.current[normalizedQuery] || [];
            const shouldMergeCache =
              cached.length > 0 && mappedResults.length > 0 && mappedResults.length < Math.min(6, cached.length);
            const mergedResults = shouldMergeCache
              ? [...mappedResults, ...cached].filter(
                  (row, idx, arr) =>
                    arr.findIndex((r) => `${r.name}|${r.address}` === `${row.name}|${row.address}`) === idx
                )
              : mappedResults;

            if (requestId !== latestSearchRequestRef.current) return;
            searchCacheRef.current[normalizedQuery] = mergedResults;
            setDetectedStores(mergedResults);
            setMapZoom(inferDefaultSearchZoom(q, mapScope));
            const sourceLabel =
              placesData?.source === "osm"
                ? "OpenStreetMap"
                : placesData?.source === "google+osm"
                  ? "Google Places + OpenStreetMap"
                : placesData?.source === "google"
                  ? "Google Places"
                  : "live map";
            setSearchNotice(`Loaded ${mergedResults.length} store result(s) from ${sourceLabel}.`);
            return;
          }
        }

        const cached = searchCacheRef.current[normalizedQuery] || [];
        if (cached.length > 0) {
          if (requestId !== latestSearchRequestRef.current) return;
          setDetectedStores(cached);
          setMapZoom(inferDefaultSearchZoom(q, mapScope));
          setSearchNotice(`Using ${cached.length} cached store result(s) for ${q}.`);
          return;
        }

        const localFiltered = normalizedStoreData.filter((store) => {
          const haystack = `${store.name} ${store.address} ${store.zip_code || ""}`.toLowerCase();
          return haystack.includes(q.toLowerCase());
        });
        if (localFiltered.length > 0) {
          if (requestId !== latestSearchRequestRef.current) return;
          setDetectedStores(localFiltered);
          setMapZoom(inferDefaultSearchZoom(q, mapScope));
          setSearchNotice(`Loaded ${localFiltered.length} saved store node(s).`);
          return;
        }

        if (requestId !== latestSearchRequestRef.current) return;
        setDetectedStores(normalizedStoreData);
        setMapZoom(inferDefaultSearchZoom(q, mapScope));
        setSearchNotice("No live stores found for that search. Showing saved store nodes instead.");
      } catch {
        if (requestId !== latestSearchRequestRef.current) return;
        setDetectedStores(normalizedStoreData);
        setMapZoom(inferDefaultSearchZoom(q, mapScope));
        setSearchNotice("Live map search failed. Showing saved store nodes instead.");
      } finally {
        if (requestId === latestSearchRequestRef.current) {
          setSearching(false);
        }
      }
    })();
  };

  const detectedStoresWithGeo = useMemo(
    () =>
      detectedStores.map((store) => {
        const override = geoOverrides[store.id];
        return override ? { ...store, lat: override.lat, lng: override.lng } : store;
      }),
    [detectedStores, geoOverrides]
  );

  const sortedStores = useMemo(
    () => [...detectedStoresWithGeo].sort((a, b) => (b.power_rank || 0) - (a.power_rank || 0)),
    [detectedStoresWithGeo]
  );

  const visibleStores = showTopOnly ? sortedStores.slice(0, 3) : sortedStores;
  const tripOrder = sortedStores.slice(0, 5);

  useEffect(() => {
    if (!selectedStore) return;
    const stillVisible = visibleStores.some((store) => String(store.id) === String(selectedStore.id));
    if (!stillVisible) {
      setSelectedStore(null);
    }
  }, [visibleStores, selectedStore]);

  const storeManifest = useMemo(() => {
    if (!selectedStore) return [];
    const strictMatches = trunk.filter((item: any) => matchesStore(item, selectedStore));
    if (strictMatches.length > 0) return strictMatches;
    return trunk.slice(0, 3);
  }, [selectedStore, trunk]);

  const pinCoordsById = useMemo(() => projectStoresToCoords(visibleStores), [visibleStores]);
  const mapCenter = useMemo(() => deriveMapCenter(visibleStores, selectedStore), [visibleStores, selectedStore]);
  const geoBounds = useMemo(() => getGeoBounds(visibleStores), [visibleStores]);
  const mapScopeConfig = useMemo(() => getMapScopeConfig(mapScope), [mapScope]);
  const hasVisibleGeoStores = useMemo(() => visibleStores.some(hasGeoPoint), [visibleStores]);
  const useInteractiveMap = mapMode === "js" && hasVisibleGeoStores;

  useEffect(() => {
    if (!useInteractiveMap || !mapCanvasRef.current || typeof window === "undefined" || !window.google?.maps) {
      return;
    }

    const gmaps = window.google.maps;

    if (!googleMapRef.current) {
      googleMapRef.current = new gmaps.Map(mapCanvasRef.current, {
        center: mapCenter || { lat: 34.0522, lng: -118.2437 },
        zoom: mapZoom,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: false,
        clickableIcons: false,
      });
      // Google Maps can render blank/blue if initialized while layout is still settling.
      window.setTimeout(() => {
        try {
          gmaps.event.trigger(googleMapRef.current, "resize");
          if (mapCenter && typeof googleMapRef.current?.setCenter === "function") {
            googleMapRef.current.setCenter(mapCenter);
          }
        } catch {
          // no-op
        }
      }, 80);
    }

    const map = googleMapRef.current;
    if (typeof map?.setZoom === "function") {
      map.setZoom(mapZoom);
    }
    if (mapCenter && typeof map?.setCenter === "function") {
      map.setCenter(mapCenter);
    }

    googleMarkersRef.current.forEach((marker) => {
      if (typeof marker?.setMap === "function") marker.setMap(null);
    });
    googleMarkersRef.current = [];
    selectedMarkerRef.current = null;

    const bounds = new gmaps.LatLngBounds();
    let markerCount = 0;

    visibleStores.forEach((store) => {
      if (!hasGeoPoint(store)) return;
      const position = { lat: Number(store.lat), lng: Number(store.lng) };
      markerCount += 1;
      if (typeof bounds.extend === "function") bounds.extend(position);

      const isSelected = selectedStore?.id === store.id;
      const marker = new gmaps.Marker({
        map,
        position,
        title: `${store.name} (${store.power_rank} PWR)`,
        icon: {
          path: gmaps.SymbolPath.CIRCLE,
          fillColor: isSelected ? "#0f172a" : "#10b981",
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 2,
          scale: isSelected ? 10 : 8,
        },
      });

      marker.addListener("click", () => {
        setSelectedStore(store);
      });

      googleMarkersRef.current.push(marker);
      if (isSelected) {
        selectedMarkerRef.current = marker;
      }
    });

    const visibleIdsKey = `${currentLocation}|${visibleStores.map((s) => s.id).join("|")}`;
    const shouldAutoFit =
      !!geoBounds &&
      geoBounds.latSpan <= mapScopeConfig.fitLatSpanMax &&
      geoBounds.lngSpan <= mapScopeConfig.fitLngSpanMax;
    if (selectedStore && hasGeoPoint(selectedStore)) {
      if (typeof map?.panTo === "function") {
        map.panTo({ lat: Number(selectedStore.lat), lng: Number(selectedStore.lng) });
      }
      if (typeof map?.getZoom === "function" && typeof map?.setZoom === "function") {
        const currentZoom = Number(map.getZoom?.() ?? mapZoom);
        if (Number.isFinite(currentZoom) && currentZoom < Math.max(12, mapZoom)) {
          map.setZoom(Math.max(12, mapZoom));
        }
      }
    } else if (markerCount > 1 && shouldAutoFit && typeof map?.fitBounds === "function") {
      if (lastAutoFitKeyRef.current !== visibleIdsKey) {
        map.fitBounds(bounds, 80);
        // Prevent over-zoom after fit when stores are tightly grouped.
        window.setTimeout(() => {
          try {
            if (typeof map?.getZoom === "function" && typeof map?.setZoom === "function") {
              const z = Number(map.getZoom());
              if (Number.isFinite(z) && z > 14) {
                map.setZoom(14);
              }
              if (Number.isFinite(z) && z < Math.max(mapScopeConfig.minZoomAfterFit, mapZoom)) {
                map.setZoom(Math.max(mapScopeConfig.minZoomAfterFit, mapZoom));
              }
            }
          } catch {
            // no-op
          }
        }, 50);
        lastAutoFitKeyRef.current = visibleIdsKey;
      }
    } else if (markerCount >= 1 && mapCenter && typeof map?.setCenter === "function") {
      map.setCenter(mapCenter);
      if (!selectedStore && typeof map?.setZoom === "function") {
        map.setZoom(clamp(mapZoom, mapScopeConfig.nonSelectedZoomMin, mapScopeConfig.nonSelectedZoomMax));
      }
    }
  }, [useInteractiveMap, visibleStores, selectedStore, mapCenter, mapZoom, currentLocation, geoBounds, mapScopeConfig]);

  const mapSrc = mapCenter
    ? GOOGLE_MAPS_EMBED_KEY
      ? `https://www.google.com/maps/embed/v1/view?key=${GOOGLE_MAPS_EMBED_KEY}&center=${mapCenter.lat},${mapCenter.lng}&zoom=${mapZoom}&maptype=roadmap`
      : `https://www.google.com/maps?q=${encodeURIComponent(`${mapCenter.lat},${mapCenter.lng}`)}&output=embed&z=${mapZoom}`
    : GOOGLE_MAPS_EMBED_KEY
      ? `https://www.google.com/maps/embed/v1/search?key=${GOOGLE_MAPS_EMBED_KEY}&q=${encodeURIComponent(
          `thrift stores in ${currentLocation}`
        )}&zoom=${mapZoom}`
      : `https://www.google.com/maps?q=${encodeURIComponent(
          `thrift stores in ${currentLocation}`
        )}&output=embed&z=${mapZoom}`;

  return (
    <div className="space-y-8 text-left animate-in fade-in duration-700 h-full flex flex-col">
      <div className="bg-emerald-500/10 border border-emerald-500/20 p-8 rounded-[2rem] flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-6">
          <div className="h-12 w-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-slate-950 shadow-lg shadow-emerald-500/20">
            <Zap size={24} />
          </div>
          <div>
            <h4 className="text-xl font-black italic uppercase tracking-tighter text-emerald-500">
              Sourcing Sector: {currentLocation}
            </h4>
            <p className="text-slate-500 font-medium italic text-sm">
              Store map sorted by current power rank and matched against your trunk.
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <button
            onClick={() => setShowTopOnly(!showTopOnly)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
              showTopOnly
                ? "bg-emerald-500 text-slate-900 border-emerald-500"
                : "bg-white dark:bg-slate-900 text-slate-500 border-slate-200 dark:border-slate-700"
            }`}
          >
            {showTopOnly ? "Top Stores Filter: On" : "Top Stores Filter: Off"}
          </button>
          <div className="text-right">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Target Items</p>
            <p className="text-2xl font-black italic text-emerald-500">{trunk.length} Active</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-[600px]">
        <div className="lg:col-span-1 flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] overflow-hidden shadow-xl">
          {selectedStore ? (
            <div className="flex flex-col h-full">
              <div className="p-8 bg-slate-900 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                  <MapIcon size={100} />
                </div>
                <button
                  onClick={() => setSelectedStore(null)}
                  className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-4 hover:underline"
                >
                  ← Back to Map
                </button>
                <h3 className="text-3xl font-black italic uppercase tracking-tighter mb-2 leading-none">
                  {selectedStore.name}
                </h3>
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2 py-1 bg-white/20 rounded text-[9px] font-bold uppercase">{selectedStore.type}</span>
                  <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded text-[9px] font-bold uppercase">
                    {selectedStore.power_rank} PWR
                  </span>
                </div>
                <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wide">
                  {selectedStore.rating ? `Rating ${selectedStore.rating.toFixed(1)}` : "Rating n/a"}
                  {selectedStore.review_count ? ` • ${selectedStore.review_count}+ reviews` : ""}
                  {selectedStore.census_income ? ` • Census MHI $${Math.round(selectedStore.census_income).toLocaleString()}` : ""}
                </p>
                <div className="flex items-start gap-2 text-slate-400 text-xs italic">
                  <Clock size={14} className="mt-0.5" />
                  <span>Best Time: {selectedStore.best_time}</span>
                </div>
              </div>

              <div className="p-6 flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950/50">
                <div className="mb-6 flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                    <Target size={14} className="text-blue-500" /> Route Manifest
                  </h4>
                  <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">
                    {storeManifest.length > 0 ? `${storeManifest.length} Matches` : "General Scout"}
                  </span>
                </div>

                {storeManifest.length > 0 ? (
                  <div className="space-y-3">
                    {storeManifest.map((item: any, i: number) => (
                      <div
                        key={`${item.id || item.name}-${i}`}
                        className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                          <div>
                            <p className="text-sm font-black italic text-slate-800 dark:text-slate-200 leading-tight">{item.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Target: ${item.entry_price || 0}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => onConfirmFound && onConfirmFound(item, selectedStore.name)}
                          className="px-3 py-1.5 bg-emerald-500 text-slate-900 text-[9px] font-black uppercase rounded-lg hover:bg-emerald-400 transition-colors"
                        >
                          Confirm
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center">
                    <p className="text-xs font-bold text-slate-400 italic">No trunk items available yet. Add items in Radar or Decision Lab first.</p>
                  </div>
                )}

                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedStore.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full mt-8 py-4 bg-emerald-500 text-slate-900 rounded-xl font-black uppercase italic text-xs tracking-widest hover:bg-emerald-400 transition-all shadow-lg flex items-center justify-center gap-2"
                >
                  <Navigation size={16} /> Navigate Now
                </a>
              </div>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-400 italic">
                  Detected Stores ({visibleStores.length})
                </h3>
                {tripOrder.length > 0 && (
                  <div className="mt-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Suggested Trip Order</p>
                    <div className="space-y-1">
                      {tripOrder.map((store, index) => (
                        <p key={store.id} className="text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300 truncate">
                          {index + 1}. {store.name} ({store.power_rank} PWR)
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {visibleStores.map((store) => (
                  <div
                    key={store.id}
                    onClick={() => setSelectedStore(store)}
                    className="p-6 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-[2rem] hover:border-emerald-500 hover:shadow-md cursor-pointer transition-all group"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="bg-amber-500/10 text-amber-600 text-[9px] font-black px-2 py-1 rounded-lg italic">{store.power_rank} PWR</span>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-500 -rotate-45 group-hover:rotate-0 transition-transform" />
                    </div>
                    <h4 className="text-lg font-black italic uppercase tracking-tighter mb-1 leading-tight text-slate-800 dark:text-slate-200">{store.name}</h4>
                    <p className="text-slate-400 text-xs font-bold italic truncate">{store.address}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-slate-100 dark:bg-slate-800 rounded-[3rem] border-4 border-white dark:border-slate-900 shadow-inner relative overflow-hidden group">
          <div className="absolute inset-0 z-0">
            {useInteractiveMap ? (
              <div
                ref={mapCanvasRef}
                className="h-full w-full contrast-110 opacity-90 hover:opacity-100 transition-opacity duration-700"
                aria-label="Interactive store map"
              />
            ) : (
              <iframe
                title="Store map"
                width="100%"
                height="100%"
                loading="lazy"
                allowFullScreen
                className="grayscale contrast-125 opacity-75 hover:opacity-100 transition-opacity duration-700"
                style={{ border: 0 }}
                src={mapSrc}
              />
            )}
            <div className="absolute inset-0 pointer-events-none z-10">
              <div className="absolute top-[30%] left-[40%] h-64 w-64 bg-emerald-500/10 rounded-full blur-3xl animate-pulse" />
              <div className="absolute top-[60%] left-[70%] h-48 w-48 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-700" />
            </div>
          </div>

          <div className="absolute top-6 left-6 right-6 md:right-auto md:w-96 z-30">
            <form onSubmit={handleSearch} className="relative shadow-2xl">
              <input
                type="text"
                placeholder="Search City, State, Zip, or Store..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-bold outline-none focus:border-emerald-500 transition-all uppercase tracking-wide text-xs"
              />
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <button
                type="submit"
                className="absolute right-2 top-2 bottom-2 px-4 bg-emerald-500 text-slate-900 rounded-xl font-black text-[10px] uppercase hover:bg-emerald-400 transition-colors"
              >
                {searching ? "Scanning..." : "Scan"}
              </button>
            </form>
            <div className="mt-2 flex items-center gap-2">
              <span className="px-2 py-1 rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-[9px] font-black uppercase tracking-widest text-slate-500">
                Scope
              </span>
              {([
                { id: "neighborhood", label: "Neighborhood" },
                { id: "city", label: "City" },
                { id: "metro", label: "Metro" },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setMapScope(option.id)}
                  className={`px-3 py-1.5 rounded-xl border text-[9px] font-black uppercase tracking-widest transition-colors ${
                    mapScope === option.id
                      ? "bg-emerald-500 text-slate-900 border-emerald-500"
                      : "bg-white/90 dark:bg-slate-900/90 text-slate-500 border-slate-200 dark:border-slate-700 hover:border-emerald-400"
                  }`}
                  title={`Set default search zoom to ${option.label.toLowerCase()} view`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {searchNotice && (
              <p className="mt-2 px-3 py-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase tracking-wide text-slate-500">
                {searchNotice}
              </p>
            )}
            {mapMode === "loading" && (
              <p className="mt-2 px-3 py-2 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase tracking-wide text-slate-500">
                Loading interactive map (Google Maps)...
              </p>
            )}
            {mapNotice && (
              <p className="mt-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10px] font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
                {mapNotice}
              </p>
            )}
          </div>

          <div className="absolute top-24 left-6 flex flex-col gap-2 z-20">
            <button
              onClick={() => setMapZoom((z) => clamp(z + 1, 8, 16))}
              className="h-10 w-10 bg-white dark:bg-slate-900 rounded-xl shadow-lg flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors"
              title="Zoom in"
            >
              <Plus size={14} />
            </button>
            <button
              onClick={() => setMapZoom((z) => clamp(z - 1, 8, 16))}
              className="h-10 w-10 bg-white dark:bg-slate-900 rounded-xl shadow-lg flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-colors"
              title="Zoom out"
            >
              <Minus size={14} />
            </button>
          </div>

          {!useInteractiveMap && visibleStores.map((store) => (
            <div
              key={`pin-${store.id}`}
              className="absolute z-40 group cursor-pointer pointer-events-auto"
              style={{
                top: (pinCoordsById[store.id] || store.coords || generateFallbackCoords(0)).top,
                left: (pinCoordsById[store.id] || store.coords || generateFallbackCoords(0)).left,
              }}
              onClick={() => setSelectedStore(store)}
            >
              <div className={`relative flex items-center justify-center transition-transform duration-300 ${selectedStore?.id === store.id ? "scale-125" : "hover:scale-110"}`}>
                <div className="absolute h-12 w-12 bg-emerald-500/30 rounded-full animate-ping" />
                <div className={`h-10 w-10 rounded-xl shadow-2xl border-2 border-white dark:border-slate-900 flex items-center justify-center ${selectedStore?.id === store.id ? "bg-slate-900 text-white" : "bg-emerald-500 text-white"}`}>
                  <MapPin size={20} fill="currentColor" />
                </div>
                <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wide whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
                  {store.name}
                </div>
              </div>
            </div>
          ))}

          {!selectedStore && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-white/90 dark:bg-slate-900/90 backdrop-blur px-8 py-4 rounded-full border border-slate-200 dark:border-slate-700 shadow-2xl z-20 flex items-center gap-4">
              <Crosshair className="text-emerald-500" size={20} />
              <p className="text-xs font-black uppercase tracking-widest text-slate-500">Select a store to scan inventory</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
