import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  inferStyleItemTypeFromTitle,
  isStyleLikeTrack,
  normalizeStyleProfilePayload,
  shouldRefreshStyleProfile,
} from "@/lib/styleGuidance";
import type {
  StyleProfile,
  StyleProfileGenerateRequest,
  StyleProfileGenerateResponse,
} from "@/lib/types";

export const runtime = "nodejs";

const STYLE_PROFILE_VERSION = "v1";
const TITLE_COOLDOWN_MS = 45_000;
const titleCooldown = new Map<string, number>();

function compactWhitespace(value: string): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getSupabaseServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
}

async function callOpenAIJsonCompletion({
  systemPrompt,
  userPrompt,
  model,
  temperature = 0.15,
  retries = 2,
  timeoutMs = 20_000,
}: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  temperature?: number;
  retries?: number;
  timeoutMs?: number;
}): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai_key_missing");

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(`openai_http_${res.status}: ${compactWhitespace(JSON.stringify(body).slice(0, 400))}`);
      }
      const text = String(body?.choices?.[0]?.message?.content || "").trim();
      if (!text) throw new Error("openai_empty_response");
      return JSON.parse(text);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error("openai_json_call_failed");
      if (attempt >= retries) break;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("openai_json_call_failed");
}

async function generateStyleProfile({
  title,
  track,
  hookBrand,
  marketSentiment,
  riskFactor,
  visualCues,
}: {
  title: string;
  track?: string | null;
  hookBrand?: string | null;
  marketSentiment?: string | null;
  riskFactor?: string | null;
  visualCues?: string[] | null;
}): Promise<{ ok: true; profile: StyleProfile } | { ok: false; error: string }> {
  const model = process.env.STYLE_PROFILE_MODEL || process.env.TREND_CLASSIFIER_MODEL || "gpt-4o-mini";
  const itemType = inferStyleItemTypeFromTitle(title);
  const systemPrompt =
    "You are a thrift sourcing operator. Return strict JSON only. Output should tell a buyer what to look for in-store, not quality boilerplate.";
  const userPrompt = JSON.stringify({
    task: "Generate a style sourcing profile for one thrift node",
    title,
    track: track || "Style Category",
    inferred_item_type: itemType,
    context: {
      hook_brand: hookBrand || null,
      market_sentiment: marketSentiment || null,
      risk_factor: riskFactor || null,
      visual_cues: Array.isArray(visualCues) ? visualCues.slice(0, 4) : [],
    },
    schema: {
      item_type: "outerwear|bottoms|footwear|knitwear|bags|dress|top|mixed",
      styles_to_find: "array, 1-3 bullets, 6-120 chars each",
      find_these_first: "array, 1-3 bullets, 6-120 chars each",
      where_to_check_first: "array, 1-2 bullets, 6-120 chars each",
      pass_if: "array, 1-2 bullets, 6-120 chars each",
      confidence_note: "string <= 140 chars",
    },
    hard_constraints: [
      "No exact or near-duplicate bullets across sections",
      "Do not use generic condition/quality filler",
      "Bullets must be specific but still findable in thrift stores",
      "Use silhouettes, variants, era cues, rack zones, and pass conditions",
      "At most 2 mainstream brand examples total, and only if category-fit",
      "If title already has a brand, do not force extra brand lines",
    ],
  });

  try {
    const payload = await callOpenAIJsonCompletion({
      systemPrompt,
      userPrompt,
      model,
      temperature: 0.15,
      retries: 2,
      timeoutMs: 20_000,
    });
    const normalized = normalizeStyleProfilePayload(payload, title);
    if (!normalized.ok) return { ok: false, error: `on_demand_invalid_profile ${normalized.error}` };
    return { ok: true, profile: normalized.profile };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "on_demand_unknown_error";
    return { ok: false, error: `on_demand_style_profile_error ${compactWhitespace(msg).slice(0, 500)}` };
  }
}

export async function POST(request: Request) {
  let payload: StyleProfileGenerateRequest;
  try {
    payload = (await request.json()) as StyleProfileGenerateRequest;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const signalId = compactWhitespace(String(payload?.signal_id || ""));
  const title = compactWhitespace(String(payload?.title || ""));
  if (!signalId || !title) {
    return NextResponse.json({ error: "signal_id_and_title_required" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_config_missing" }, { status: 500 });
  }

  const { data: signal, error: readError } = await supabase
    .from("market_signals")
    .select(
      "id,trend_name,track,hook_brand,market_sentiment,risk_factor,visual_cues,style_profile_json,style_profile_status,style_profile_error,style_profile_updated_at"
    )
    .eq("id", signalId)
    .single();

  if (readError || !signal) {
    return NextResponse.json({ error: "signal_not_found" }, { status: 404 });
  }

  const effectiveTrack = compactWhitespace(String(payload.track || signal.track || ""));
  if (!isStyleLikeTrack(effectiveTrack)) {
    const response: StyleProfileGenerateResponse = {
      ok: false,
      generated: false,
      style_profile_status: "missing",
      style_profile_error: "not_style_track",
      style_profile_json: null,
      style_profile_updated_at: null,
    };
    return NextResponse.json(response, { status: 400 });
  }

  const ttlDays = Math.max(1, Number(process.env.STYLE_PROFILE_TTL_DAYS || 14));
  const fresh = !shouldRefreshStyleProfile(
    {
      trend_name: signal.trend_name,
      style_profile_status: signal.style_profile_status,
      style_profile_json: signal.style_profile_json,
      style_profile_updated_at: signal.style_profile_updated_at,
    },
    ttlDays
  );
  const existingNormalized = normalizeStyleProfilePayload(signal.style_profile_json, title);
  if (fresh && existingNormalized.ok) {
    const response: StyleProfileGenerateResponse = {
      ok: true,
      generated: false,
      style_profile_status: "ok",
      style_profile_error: null,
      style_profile_json: existingNormalized.profile,
      style_profile_updated_at: signal.style_profile_updated_at || null,
    };
    return NextResponse.json(response);
  }

  const cooldownKey = `${signalId}:${title.toLowerCase()}`;
  const now = Date.now();
  const lastRun = titleCooldown.get(cooldownKey) || 0;
  if (now - lastRun < TITLE_COOLDOWN_MS) {
    const response: StyleProfileGenerateResponse = {
      ok: false,
      generated: false,
      style_profile_status: "error",
      style_profile_error: "on_demand_cooldown_active",
      style_profile_json: null,
      style_profile_updated_at: signal.style_profile_updated_at || null,
    };
    return NextResponse.json(response, { status: 429 });
  }
  titleCooldown.set(cooldownKey, now);

  const generated = await generateStyleProfile({
    title,
    track: effectiveTrack,
    hookBrand: compactWhitespace(String(payload.hook_brand || signal.hook_brand || "")) || null,
    marketSentiment: signal.market_sentiment,
    riskFactor: signal.risk_factor,
    visualCues: Array.isArray(signal.visual_cues) ? signal.visual_cues : [],
  });

  if (!generated.ok) {
    const errorText = generated.error;
    await supabase
      .from("market_signals")
      .update({
        style_profile_json: null,
        style_profile_status: "error",
        style_profile_error: errorText,
        style_profile_version: STYLE_PROFILE_VERSION,
        style_profile_updated_at: new Date().toISOString(),
      })
      .eq("id", signalId);

    const response: StyleProfileGenerateResponse = {
      ok: false,
      generated: false,
      style_profile_status: "error",
      style_profile_error: errorText,
      style_profile_json: null,
      style_profile_updated_at: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 502 });
  }

  const updatedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("market_signals")
    .update({
      style_profile_json: generated.profile,
      style_profile_status: "ok",
      style_profile_error: null,
      style_profile_version: STYLE_PROFILE_VERSION,
      style_profile_updated_at: updatedAt,
    })
    .eq("id", signalId);

  if (updateError) {
    const response: StyleProfileGenerateResponse = {
      ok: false,
      generated: false,
      style_profile_status: "error",
      style_profile_error: `on_demand_update_failed ${updateError.message}`,
      style_profile_json: null,
      style_profile_updated_at: updatedAt,
    };
    return NextResponse.json(response, { status: 500 });
  }

  const response: StyleProfileGenerateResponse = {
    ok: true,
    generated: true,
    style_profile_status: "ok",
    style_profile_error: null,
    style_profile_json: generated.profile,
    style_profile_updated_at: updatedAt,
  };
  return NextResponse.json(response);
}
