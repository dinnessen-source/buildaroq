"use client";

import { useState, useTransition } from "react";
import {
  markQuoteAsSent,
  markQuoteAsAccepted,
  markQuoteAsDeclined,
  markQuoteAsDraft,
  type QuoteStatus,
} from "../actions";

export default function QuoteStatusActions({
  quoteId,
  status,
}: {
  quoteId: string;
  status: QuoteStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: (id: string) => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn(quoteId);
      } catch (e: any) {
        setError(e?.message ?? "Actie mislukt");
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      {status === "draft" && (
        <button
          onClick={() => run(markQuoteAsSent)}
          disabled={isPending}
          className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Markeer als verzonden
        </button>
      )}

      {status === "sent" && (
        <>
          <button
            onClick={() => run(markQuoteAsAccepted)}
            disabled={isPending}
            className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Markeer als geaccepteerd
          </button>

          <button
            onClick={() => run(markQuoteAsDeclined)}
            disabled={isPending}
            className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Markeer als afgewezen
          </button>
        </>
      )}

      {status === "declined" && (
        <button
          onClick={() => run(markQuoteAsDraft)}
          disabled={isPending}
          className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          Terug naar concept
        </button>
      )}

      {status === "accepted" && (
        <span className="text-sm font-medium text-emerald-700">
          Geaccepteerd
        </span>
      )}

      {isPending ? <span className="text-sm text-gray-500">Bezig…</span> : null}
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}
