import Link from "next/link";

type Status =
  | "all"
  | "open"
  | "draft"
  | "sent"
  | "paid"
  | "overdue"
  | "cancelled";

export function InvoicesFilters({
  status,
  source,
}: {
  status: string;
  source: string;
}) {
  const active = (status as Status) || "all";

  function href(nextStatus: Status) {
    const sp = new URLSearchParams();

    // status
    if (nextStatus !== "all") sp.set("status", nextStatus);

    // source behouden
    if (source && source !== "all") sp.set("source", source);

    const qs = sp.toString();
    return qs ? `/app/invoices?${qs}` : "/app/invoices";
  }

  const items: { key: Status; label: string }[] = [
    { key: "all", label: "Alle" },
    { key: "open", label: "Open" },
    { key: "draft", label: "Concept" },
    { key: "sent", label: "Verstuurd" },
    { key: "paid", label: "Betaald" },
    { key: "overdue", label: "Te laat" },
    { key: "cancelled", label: "Geannuleerd" },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const isActive = active === it.key;
        return (
          <Link
            key={it.key}
            href={href(it.key)}
            className={`rounded-full border px-3 py-1 text-sm ${
              isActive
                ? "bg-black text-white border-black"
                : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
            }`}
          >
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
