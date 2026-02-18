import { NextResponse } from "next/server";

const GOOGLE_PLACES_API_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const rawLimit = Number(searchParams.get("limit") || 8);
  const limit = Math.max(1, Math.min(12, Number.isFinite(rawLimit) ? rawLimit : 8));

  if (!q) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "google_places_key_missing" }, { status: 503 });
  }

  const endpoint = `${GOOGLE_PLACES_API_URL}?query=${encodeURIComponent(
    `thrift stores in ${q}`
  )}&key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const body = await res.json();
    if (!res.ok || body?.status === "REQUEST_DENIED") {
      return NextResponse.json(
        {
          error: "google_places_failed",
          details: body?.error_message || body?.status || `http_${res.status}`,
        },
        { status: 502 }
      );
    }

    const results = Array.isArray(body?.results) ? body.results.slice(0, limit) : [];
    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json(
      { error: "google_places_exception", details: err?.message || "unknown_error" },
      { status: 502 }
    );
  }
}
