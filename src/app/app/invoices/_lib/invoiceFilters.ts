// app/invoices/_lib/invoiceFilters.ts

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";
export type StatusFilter = "all" | "open" | InvoiceStatus;
export type SourceFilter = "all" | "quote" | "manual";

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

export function parseStatus(v?: string | null): StatusFilter {
  const s = String(v ?? "").trim();
  if (!s) return "all";
  if (s === "all" || s === "open") return s;
  if (["draft", "sent", "paid", "overdue", "cancelled"].includes(s)) return s as InvoiceStatus;
  return "all";
}

export function parseSource(v?: string | null): SourceFilter {
  const s = String(v ?? "").trim();
  if (!s) return "all";
  if (s === "all" || s === "quote" || s === "manual") return s;
  return "all";
}

export function buildHref(
  basePath: string,
  params: {
    q?: string;
    status?: StatusFilter;
    source?: SourceFilter;
    from?: string;
    to?: string;
    page?: number;
  }
) {
  const sp = new URLSearchParams();

  if (params.q) sp.set("q", params.q);
  if (params.status && params.status !== "all") sp.set("status", params.status);
  if (params.source && params.source !== "all") sp.set("source", params.source);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.page && params.page > 1) sp.set("page", String(params.page));

  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}