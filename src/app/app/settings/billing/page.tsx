import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "../../../../lib/supabase/server";
import BillingForm from "./_BillingForm";

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ err?: string; ok?: string }>;
}) {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) redirect("/login");

  const sp = (await searchParams) ?? {};
  const errMsg = sp.err ? decodeURIComponent(sp.err) : null;
  const okMsg = sp.ok ? "Opgeslagen." : null;

  const { data: profile } = await sb
    .from("profiles")
    .select(
      "company_name,company_email,phone,address_line1,address_line2,postal_code,city,country,vat_number,chamber_of_commerce"
    )
    .eq("id", user.id)
    .single();

const { data: billing } = await sb
  .from("billing_settings")
  .select("currency,default_vat_rate,quote_footer,iban,invoice_footer,payment_terms_days,logo_path")
  .eq("user_id", user.id)
  .single();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold underline">Instellingen</h1>
          <p className="text-gray-600">Deze info komt in je PDF (“Van”).</p>
        </div>

        <Link className="underline" href="/app/settings">
          Terug
        </Link>
      </div>

      <BillingForm profile={profile} billing={billing} errMsg={errMsg} okMsg={okMsg} />
    </div>
  );
}