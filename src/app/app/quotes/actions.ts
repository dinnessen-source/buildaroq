"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "../../../lib/supabase/server";

export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

async function setQuoteStatus(quoteId: string, status: QuoteStatus) {
  const sb = await supabaseServer();

  const { error } = await sb.from("quotes").update({ status }).eq("id", quoteId);

  if (error) throw new Error(error.message);

  revalidatePath(`/app/quotes/${quoteId}`);
  revalidatePath(`/app/quotes`);
}

export async function markQuoteAsSent(quoteId: string) {
  await setQuoteStatus(quoteId, "sent");
}

export async function markQuoteAsAccepted(quoteId: string) {
  await setQuoteStatus(quoteId, "accepted");
}

export async function markQuoteAsDeclined(quoteId: string) {
  await setQuoteStatus(quoteId, "declined");
}

export async function markQuoteAsDraft(quoteId: string) {
  await setQuoteStatus(quoteId, "draft");
}
