// src/app/app/quotes/_lib/quoteFilters.ts

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";
export type BilledFilter = "all" | "yes" | "no";

export function clampIsoDate(s: string) {
  if (!s) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s;
}

export function addOneDay(yyyyMmDd: string) {
  const d = new Date(`${yyyyMmDd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function parseStatus(v: string | undefined): "all" | QuoteStatus {
  const s = (v ?? "all").trim();
  return s === "draft" || s === "sent" || s === "accepted" || s === "declined" ? s : "all";
}

export function parseBilled(v: string | undefined): BilledFilter {
  const b = (v ?? "all").trim();
  return b === "yes" ? "yes" : b === "no" ? "no" : "all";
}

export function buildHref(
  basePath: string,
  params: {
    q?: string;
    status?: "all" | QuoteStatus;
    billed?: BilledFilter;
    from?: string;
    to?: string;
    page?: number;
  }
) {
  const sp = new URLSearchParams();

  if (params.q && params.q.trim()) sp.set("q", params.q.trim());
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.billed && params.billed !== "all") sp.set("billed", params.billed);

  if (params.from && params.from.trim()) sp.set("from", params.from.trim());
  if (params.to && params.to.trim()) sp.set("to", params.to.trim());

  if (params.page && params.page > 1) sp.set("page", String(params.page));

  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
