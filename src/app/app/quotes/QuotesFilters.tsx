"use client";

// src/app/app/quotes/QuotesFilters.tsx

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BilledFilter, QuoteStatus } from "./_lib/quoteFilters";
import { buildHref, clampIsoDate, parseBilled, parseStatus } from "./_lib/quoteFilters";

export function QuotesFilters({
  basePath,
  initialQ,
  initialStatus,
  initialBilled,
  initialFrom,
  initialTo,
}: {
  basePath: string;
  initialQ: string;
  initialStatus: "all" | QuoteStatus;
  initialBilled: BilledFilter;
  initialFrom: string;
  initialTo: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initialQ);
  const [status, setStatus] = useState<"all" | QuoteStatus>(initialStatus);
  const [billed, setBilled] = useState<BilledFilter>(initialBilled);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  // Sync bij back/forward
  useEffect(() => {
    setQ((sp.get("q") ?? "").trim());
    setStatus(parseStatus(sp.get("status") ?? undefined));
    setBilled(parseBilled(sp.get("billed") ?? undefined));
    setFrom(clampIsoDate(sp.get("from") ?? ""));
    setTo(clampIsoDate(sp.get("to") ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  const hasActiveFilters = useMemo(() => {
    return Boolean(q || status !== "all" || billed !== "all" || from || to);
  }, [q, status, billed, from, to]);

  function go(
    next: Partial<{
      q: string;
      status: "all" | QuoteStatus;
      billed: BilledFilter;
      from: string;
      to: string;
    }>
  ) {
    const nextQ = next.q ?? q;
    const nextStatus = next.status ?? status;
    const nextBilled = next.billed ?? billed;
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;

    const href = buildHref(basePath, {
      q: nextQ,
      status: nextStatus,
      billed: nextBilled,
      from: nextFrom,
      to: nextTo,
      page: 1,
    });

    startTransition(() => router.replace(href));
  }

  // Debounce search
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(() => {
      go({ q });
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const inputCls =
    "h-11 w-full rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10";
  const selectCls =
    "h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm outline-none transition focus:border-black focus:ring-2 focus:ring-black/10";

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm overflow-hidden">
      {/* Mobile/tablet: stack. Desktop: strict grid to prevent overlap */}
<div
  className="
    grid gap-4
    grid-cols-1
    lg:grid-cols-[minmax(280px,1fr)_80px_140px_160px_150px]
    lg:grid-rows-[auto_auto]
    lg:items-start
  "
>

        {/* Zoeken */}
        <div className="lg:col-start-1 lg:row-start-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">Zoeken</label>
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek op offertenummer of klant…"
              className={`${inputCls} pr-10`}
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  go({ q: "" });
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-black"
                aria-label="Wis zoekterm"
                title="Wis"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Reset */}
        <div className="lg:col-start-2 lg:row-start-1">
  {/* exact dezelfde label structuur als andere velden */}
  <label className="block text-xs font-medium text-transparent mb-1">
    Reset
  </label>

  <button
    type="button"
    onClick={() => startTransition(() => router.replace(basePath))}
    className="h-11 w-full rounded-xl border border-zinc-300 bg-white text-sm hover:bg-zinc-50 transition"
  >
    Reset
  </button>
</div>



        {/* Status */}
        <div className="lg:col-start-3 lg:row-start-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">Status</label>
          <select
            value={status === "all" ? "" : status}
            onChange={(e) => {
              const v = parseStatus(e.target.value || "all");
              setStatus(v);
              go({ status: v });
            }}
            className={selectCls}
          >
            <option value="">Alle statussen</option>
            <option value="draft">Concept</option>
            <option value="sent">Verzonden</option>
            <option value="accepted">Geaccepteerd</option>
            <option value="declined">Afgewezen</option>
          </select>
        </div>

        {/* Factuur */}
        <div className="lg:col-start-4 lg:row-start-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">Factuur</label>
          <select
            value={billed === "all" ? "" : billed}
            onChange={(e) => {
              const v = parseBilled(e.target.value || "all");
              setBilled(v);
              go({ billed: v });
            }}
            className={selectCls}
          >
            <option value="">Alles</option>
            <option value="yes">Gefactureerd</option>
            <option value="no">Niet gefactureerd</option>
          </select>
        </div>

        {/* Van */}
        <div className="lg:col-start-5 lg:row-start-1">
          <label className="block text-xs font-medium text-zinc-600 mb-1">Van</label>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              const v = clampIsoDate(e.target.value);
              setFrom(v);
              go({ from: v });
            }}
            className={inputCls}
          />
        </div>

        {/* Hint onder Zoeken */}
        <div className="lg:col-start-1 lg:row-start-2">
          <div className="text-xs text-zinc-500">
            {isPending ? "Bezig met laden…" : "Filters worden automatisch toegepast."}
          </div>
        </div>

        {/* Tot onder Van */}
        <div className="lg:col-start-5 lg:row-start-2">
          <label className="block text-xs font-medium text-zinc-600 mb-1">Tot</label>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              const v = clampIsoDate(e.target.value);
              setTo(v);
              go({ to: v });
            }}
            className={inputCls}
          />
        </div>
      </div>
    </div>
  );
}
