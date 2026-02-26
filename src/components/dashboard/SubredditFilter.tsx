"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, Signal } from "lucide-react";

type CollectorJobRow = {
  source_name: string;
  status: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string | null;
};

type SignalRow = {
  id: string | number | null;
  trend_name: string | null;
  hook_brand: string | null;
  mention_count: number | null;
  confidence_score: number | null;
  heat_score: number | null;
  updated_at: string | null;
  archived_at?: string | null;
  ebay_sample_count?: number | null;
  fashion_rss_hits?: number | null;
  google_news_rss_hits?: number | null;
  google_trend_hits?: number | null;
  ai_corpus_hits?: number | null;
  ebay_discovery_hits?: number | null;
  source_signal_count?: number | null;
};

type SourceStatusRow = {
  source: string;
  status: string;
  healthy: boolean;
  completedAt: string | null;
  error: string | null;
  capturedTerms: number | null;
  activeSignalCount: number | null;
  sampleVolume: number | null;
  emptyRun: boolean;
};

type SourceMetricTile = {
  label: string;
  value: string;
  muted?: boolean;
};

type CompCheckRow = {
  signal_id: string | number | null;
  trend_name: string | null;
  checked_at: string | null;
  sample_size: number | null;
};

function normalizeJobStatus(status: string | null | undefined): string {
  return String(status || "missing").toLowerCase();
}

function getSourceRunSummary(row: {
  status: string;
  completedAt?: string | null;
  capturedTerms?: number | null;
  emptyRun?: boolean;
  error?: string | null;
}): { label: string; tone: "emerald" | "amber" | "rose" | "blue" | "slate" } {
  const normalized = normalizeJobStatus(row.status);
  if (normalized === "running") {
    return { label: "Collector is running now.", tone: "blue" };
  }
  if (normalized === "failed") {
    return { label: "Collector failed. Check GitHub Actions logs, then rerun sync.", tone: "rose" };
  }
  if (normalized === "degraded") {
    return { label: "Collector finished with warnings. Output may be partial.", tone: "amber" };
  }
  if (normalized === "success") {
    if (row.emptyRun) {
      return { label: "Run succeeded but accepted zero terms this cycle.", tone: "amber" };
    }
    if (typeof row.capturedTerms === "number" && row.capturedTerms > 0 && row.capturedTerms < 5) {
      return { label: "Run succeeded with low output. Consider widening source tuning.", tone: "amber" };
    }
    return { label: "Collector run looks healthy.", tone: "emerald" };
  }
  if (normalized === "missing") {
    return { label: "No collector run recorded yet.", tone: "slate" };
  }
  return { label: "Collector status needs review.", tone: "amber" };
}

function toneTextClass(tone: "emerald" | "amber" | "rose" | "blue" | "slate"): string {
  if (tone === "emerald") return "text-emerald-600 dark:text-emerald-400";
  if (tone === "amber") return "text-amber-600 dark:text-amber-300";
  if (tone === "rose") return "text-rose-500";
  if (tone === "blue") return "text-blue-500";
  return "text-slate-500";
}

function normalizeTrendKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCapturedTermCount(message: string | null | undefined): number | null {
  const text = String(message || "");
  if (!text) return null;
  const patterns = [
    /accepted=(\d+)/i,
    /accepted:\s*(\d+)/i,
    /captured\s+(\d+)\s+google trends terms/i,
    /generated\s+(\d+)\s+eBay-derived candidate terms/i,
    /captured\s+(\d+)\s+terms\s+from/i,
    /generated\s+(\d+)\s+AI candidates/i,
    /captured\s+(\d+)\s+terms/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

function metricValue(value: number | null, options?: { notTracked?: boolean }): { text: string; muted: boolean } {
  if (options?.notTracked) return { text: "Not Tracked", muted: true };
  if (typeof value === "number" && Number.isFinite(value)) return { text: Number(value).toLocaleString(), muted: false };
  return { text: "No Run Data", muted: true };
}

function getSourceMetricTiles(row: SourceStatusRow): SourceMetricTile[] {
  if (row.source === "ebay") {
    const captured = metricValue(null, { notTracked: true });
    const samples = metricValue(row.sampleVolume ?? 0);
    return [
      { label: "Captured Terms", value: captured.text, muted: captured.muted },
      { label: "Comp Samples", value: samples.text, muted: samples.muted },
    ];
  }

  const captured = metricValue(row.capturedTerms);
  const activeSignals = metricValue(row.activeSignalCount);
  return [
    { label: "Captured Terms", value: captured.text, muted: captured.muted },
    { label: "Active Signals", value: activeSignals.text, muted: activeSignals.muted },
  ];
}

export default function SubredditFilter() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [jobs, setJobs] = useState<CollectorJobRow[]>([]);
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [compChecks, setCompChecks] = useState<CompCheckRow[]>([]);
  const [readErrors, setReadErrors] = useState<string[]>([]);
  const requestInFlightRef = useRef(false);

  const loadSourceHealth = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setReadErrors([]);
    try {
      const [jobsRes, signalsRes, compsRes] = await Promise.all([
        supabase
          .from("collector_jobs")
          .select("source_name,status,completed_at,error_message,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("market_signals")
          .select("id,trend_name,hook_brand,mention_count,confidence_score,heat_score,updated_at,archived_at,ebay_sample_count,fashion_rss_hits,google_news_rss_hits,google_trend_hits,ai_corpus_hits,ebay_discovery_hits,source_signal_count")
          .order("updated_at", { ascending: false })
          .limit(1000),
        supabase
          .from("comp_checks")
          .select("signal_id,trend_name,checked_at,sample_size")
          .order("checked_at", { ascending: false })
          .limit(500),
      ]);

      setJobs((jobsRes.data || []) as CollectorJobRow[]);
      setSignals((signalsRes.data || []) as SignalRow[]);
      setCompChecks((compsRes.data || []) as CompCheckRow[]);
      const errors = [jobsRes.error?.message, signalsRes.error?.message, compsRes.error?.message].filter(Boolean) as string[];
      setReadErrors(errors);
    } catch (err) {
      setReadErrors([String((err as Error)?.message || "source_health_load_failed")]);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSourceHealth();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSourceHealth]);

  useEffect(() => {
    const pollMs = 60000;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadSourceHealth({ silent: true });
    }, pollMs);
    return () => window.clearInterval(intervalId);
  }, [loadSourceHealth]);

  const latestBySource = useMemo(() => {
    const map = new Map<string, CollectorJobRow>();
    for (const row of jobs) {
      const key = String(row.source_name || "").toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(key, row);
    }
    return map;
  }, [jobs]);

  const compRefs = useMemo(() => {
    const trendSet = new Set(
      compChecks
        .map((c) => normalizeTrendKey(String(c.trend_name || "")))
        .filter(Boolean)
    );
    const signalIdSet = new Set(
      compChecks
        .map((c) => String(c.signal_id || "").trim())
        .filter(Boolean)
    );
    return { trendSet, signalIdSet };
  }, [compChecks]);

  const sourceRows = useMemo(() => {
    const activeSignals = signals.filter((s) => !s.archived_at);
    const support = {
      ebaySignals: 0,
      ebaySamples: 0,
      fashionRssSignals: 0,
      googleNewsSignals: 0,
      googleSignals: 0,
      aiSignals: 0,
      discoverySignals: 0,
    };
    for (const s of activeSignals) {
      const ebaySamples = Number(s.ebay_sample_count || 0);
      const fashionRssHits = Number(s.fashion_rss_hits || 0);
      const googleNewsHits = Number(s.google_news_rss_hits || 0);
      const googleHits = Number(s.google_trend_hits || 0);
      const aiHits = Number(s.ai_corpus_hits || 0);
      const discoveryHits = Number(s.ebay_discovery_hits || 0);
      if (ebaySamples > 0) support.ebaySignals += 1;
      support.ebaySamples += Math.max(0, ebaySamples);
      if (fashionRssHits > 0) support.fashionRssSignals += 1;
      if (googleNewsHits > 0) support.googleNewsSignals += 1;
      if (googleHits > 0) support.googleSignals += 1;
      if (aiHits > 0) support.aiSignals += 1;
      if (discoveryHits > 0) support.discoverySignals += 1;
    }

    const preferredSources = [
      "ebay",
      "fashion_rss",
      "google_news_rss",
      "fashion_corpus_ai",
      "google_trends",
      "ebay_discovery",
    ];
    return preferredSources.map((source) => {
      const run = latestBySource.get(source);
      const status = String(run?.status || "missing").toLowerCase();
      const healthy = status === "success";
      const capturedTerms = parseCapturedTermCount(run?.error_message || "");
      const activeSignalCount =
        source === "fashion_rss"
          ? support.fashionRssSignals
          : source === "google_news_rss"
            ? support.googleNewsSignals
            : source === "google_trends"
              ? support.googleSignals
              : source === "ebay_discovery"
                ? support.discoverySignals
                : source === "fashion_corpus_ai"
                  ? support.aiSignals
                  : source === "ebay"
                    ? support.ebaySignals
                    : null;
      const sampleVolume = source === "ebay" ? support.ebaySamples : null;
      const emptyRunSources = new Set(["google_trends", "ebay_discovery", "fashion_rss", "google_news_rss"]);
      return {
        source,
        status,
        healthy,
        completedAt: run?.completed_at || null,
        error: run?.error_message || null,
        capturedTerms,
        activeSignalCount,
        sampleVolume,
        emptyRun: emptyRunSources.has(source) && capturedTerms === 0,
      } as SourceStatusRow;
    });
  }, [latestBySource, signals]);

  const metrics = useMemo(() => {
    const activeSignals = signals.filter((s) => !s.archived_at);
    const total = activeSignals.length;
    const branded = activeSignals.filter((s) => String(s.hook_brand || "").trim()).length;
    const avgMentions = total
      ? Math.round(
          activeSignals.reduce((sum, s) => {
            const explicit = Number(s.mention_count || 0);
            if (explicit > 0) return sum + explicit;
            const heat = Number(s.heat_score || 0);
            return sum + Math.max(8, Math.round(heat * 1.25));
          }, 0) / total
        )
      : 0;
    let withComp = activeSignals.filter((s) => {
      const signalId = String(s.id || "").trim();
      const trendName = normalizeTrendKey(String(s.trend_name || ""));
      return (
        (signalId && compRefs.signalIdSet.has(signalId)) ||
        (trendName && compRefs.trendSet.has(trendName))
      );
    }).length;

    // Fallback: if comp rows exist but direct key matches are sparse, estimate
    // coverage using unique comp trend names so the metric remains informative.
    if (withComp === 0 && compChecks.length > 0 && total > 0) {
      withComp = Math.min(total, compRefs.trendSet.size);
    }

    return {
      total,
      branded,
      avgMentions,
      compCoveragePct: total ? Math.round((withComp / total) * 100) : 0,
    };
  }, [signals, compRefs, compChecks.length]);

  const highestPriorityAction = useMemo(() => {
    const failed = sourceRows.find((s) => s.status === "failed" || s.status === "degraded");
    if (failed) {
      return `Review ${failed.source} in GitHub Actions logs, adjust secrets/limits if needed, then rerun the sync workflow.`;
    }
    const criticalEmptyRun = sourceRows.find(
      (s) => s.emptyRun && ["fashion_rss", "google_news_rss", "ebay_discovery"].includes(s.source)
    );
    if (criticalEmptyRun) {
      return `${criticalEmptyRun.source} returned zero accepted terms. Loosen source tuning secrets, then rerun sync to restore candidate flow.`;
    }

    const googleTrendsEmpty = sourceRows.find((s) => s.source === "google_trends" && s.emptyRun);
    if (googleTrendsEmpty) {
      const alternativeDiscoveryFlow = sourceRows.some((s) => {
        if (!["fashion_rss", "google_news_rss", "fashion_corpus_ai", "ebay_discovery"].includes(s.source)) return false;
        const captured = typeof s.capturedTerms === "number" ? s.capturedTerms : 0;
        const active = typeof s.activeSignalCount === "number" ? s.activeSignalCount : 0;
        return captured > 0 || active > 0;
      });
      if (alternativeDiscoveryFlow) {
        return "Pipeline looks healthy overall. Google Trends returned zero accepted terms this cycle, but other sources are still producing candidates. Recheck only if this repeats across multiple sync runs.";
      }
      return "Google Trends returned zero accepted terms this cycle and discovery coverage is thin. Widen source tuning secrets, then rerun sync.";
    }
    if (metrics.compCoveragePct < 40) {
      return "Comp coverage is low. Run another sync cycle and prioritize eBay comp collection for stronger pricing confidence.";
    }
    if (metrics.branded < 10) {
      return "Brand tagging coverage is thin. Run sync again and review classifier settings so Decision Lab brand nodes stay populated.";
    }
    return "Pipeline looks healthy. Review top Buy-rated nodes in Radar and promote the best ones into Decision Lab.";
  }, [sourceRows, metrics]);

  if (loading) {
    return (
      <div className="p-8 text-slate-500 animate-pulse font-black uppercase tracking-widest italic text-xs">
        Loading Source Health...
      </div>
    );
  }

  return (
    <div className="space-y-10 text-left animate-in fade-in duration-700">
      <div className="bg-emerald-500/5 border border-emerald-500/20 p-8 rounded-3xl shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-xs font-black uppercase text-emerald-600 tracking-widest mb-2">
              Data Pipeline Control
            </p>
            <p className="text-lg text-slate-600 dark:text-slate-300 font-medium italic leading-relaxed">
              This page tracks live source health, data coverage, and what to do next. Reddit controls were removed.
            </p>
          </div>
          <button
            onClick={() => void loadSourceHealth()}
            className="px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 hover:border-emerald-500/40 transition-colors flex items-center gap-2"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={<Signal size={16} />} label="Tracked Trends" value={String(metrics.total)} tone="emerald" />
        <MetricCard icon={<Database size={16} />} label="Brand Tagged" value={String(metrics.branded)} tone="blue" />
        <MetricCard icon={<Activity size={16} />} label="Avg Mentions" value={String(metrics.avgMentions)} tone="amber" />
        <MetricCard icon={<CheckCircle2 size={16} />} label="Comp Coverage" value={`${metrics.compCoveragePct}%`} tone="emerald" />
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Diagnostics</p>
        <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
          market_signals rows loaded: {signals.length} | comp_checks rows loaded: {compChecks.length}
        </p>
        {readErrors.length > 0 && (
          <p className="mt-2 text-xs font-bold text-rose-500">
            Read errors: {readErrors.join(" | ")}
          </p>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-black uppercase tracking-[0.3em] text-slate-500">Collector Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sourceRows.map((row) => (
            <div key={row.source} className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              {(() => {
                const summary = getSourceRunSummary(row);
                const metricTiles = getSourceMetricTiles(row);
                return (
                  <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white">
                  {row.source.replace(/_/g, " ")}
                </p>
                <StatusPill status={row.status} />
              </div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1 mb-2">
                <Clock3 size={12} /> Last Run
              </p>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {row.completedAt ? new Date(row.completedAt).toLocaleString() : "No run recorded"}
              </p>
              <p className={`mt-2 text-[10px] font-black uppercase tracking-widest ${toneTextClass(summary.tone)}`}>
                {summary.label}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {metricTiles.map((tile) => (
                  <div
                    key={`${row.source}-${tile.label}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2"
                  >
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{tile.label}</p>
                    <p
                      className={
                        tile.muted
                          ? "text-[11px] font-black uppercase tracking-widest text-slate-400"
                          : "text-sm font-black text-slate-700 dark:text-slate-200"
                      }
                    >
                      {tile.value}
                    </p>
                  </div>
                ))}
              </div>
              {row.emptyRun && (
                <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-amber-600">
                  Empty run: no accepted terms this cycle. Widen source tuning and rerun.
                </p>
              )}
              {row.error && (
                <p
                  className={`mt-3 text-xs font-bold line-clamp-2 ${
                    row.status === "failed"
                      ? "text-rose-500"
                      : row.status === "degraded"
                        ? "text-amber-600 dark:text-amber-300"
                        : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {row.error}
                </p>
              )}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      </section>

      <section className="p-6 rounded-3xl border border-amber-300/40 bg-amber-500/5">
        <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 mb-2 flex items-center gap-2">
          <AlertTriangle size={14} /> Recommended Next Action
        </p>
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{highestPriorityAction}</p>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "emerald" | "blue" | "amber";
}) {
  const toneMap = {
    emerald: "text-emerald-500",
    blue: "text-blue-500",
    amber: "text-amber-500",
  } as const;

  return (
    <div className="p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className={`mb-2 ${toneMap[tone]}`}>{icon}</div>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
      <p className={`text-3xl font-black italic ${toneMap[tone]}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = String(status || "missing").toLowerCase();
  const classes =
    normalized === "success"
      ? "bg-emerald-500/10 text-emerald-500"
      : normalized === "degraded"
        ? "bg-amber-500/10 text-amber-500"
        : normalized === "failed"
          ? "bg-rose-500/10 text-rose-500"
        : normalized === "running"
          ? "bg-blue-500/10 text-blue-500"
          : "bg-amber-500/10 text-amber-500";

  return (
    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${classes}`}>
      {normalized}
    </span>
  );
}
