import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export type InvoicePdfData = {
  brandName: string;
  invoice: {
    id: string;
    invoice_number: string;
    status: string;
    notes: string | null;
    footer: string | null;
    created_at: string;
    due_date: string | null;
  };
  seller: {
    company_name: string | null;
    company_email: string | null;
    phone: string | null;
    address_line1: string | null;
    address_line2: string | null;
    postal_code: string | null;
    city: string | null;
    country: string | null;
    vat_number: string | null;
    chamber_of_commerce: string | null;
    iban: string | null;
  };
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  items: Array<{
    description: string;
    qty: number;
    unit: string | null;
    unit_price: number;
  }>;
  totals: {
    currency: string;
    prices_include_vat: boolean;
    vat_rate: number;
    subtotal: number;
    vat_amount: number;
    total: number;
  };
};

function money(value: number, currency: string) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(value);
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  h1: { fontSize: 18, fontWeight: "bold" },
  h2: { fontSize: 11, fontWeight: "bold" },
  muted: { color: "#555" },
  card: { border: "1px solid #E5E7EB", borderRadius: 10, padding: 12 },
  tableHeader: { flexDirection: "row", borderBottom: "1px solid #E5E7EB", paddingBottom: 6, marginTop: 10 },
  th: { fontWeight: "bold", color: "#111" },
  tr: { flexDirection: "row", borderBottom: "1px solid #F1F5F9", paddingVertical: 6 },
  colDesc: { flex: 6, paddingRight: 10 },
  colQty: { flex: 1.5, textAlign: "right" },
  colPrice: { flex: 2, textAlign: "right" },
  colTotal: { flex: 2, textAlign: "right" },
  totalsBox: { marginTop: 10, alignSelf: "flex-end", width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  divider: { height: 1, backgroundColor: "#E5E7EB", marginVertical: 10 },
});

export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const { invoice, seller, customer, items, totals, brandName } = data;

  const sellerLines = [
    seller.company_name,
    seller.address_line1,
    seller.address_line2,
    [seller.postal_code, seller.city].filter(Boolean).join(" "),
    seller.country,
  ].filter(Boolean);

  const metaLeft = [
    seller.company_email ? `Email: ${seller.company_email}` : null,
    seller.phone ? `Tel: ${seller.phone}` : null,
    seller.vat_number ? `BTW: ${seller.vat_number}` : null,
    seller.chamber_of_commerce ? `KvK: ${seller.chamber_of_commerce}` : null,
    seller.iban ? `IBAN: ${seller.iban}` : null,
  ].filter(Boolean);

  const invDate = new Date(invoice.created_at).toLocaleDateString("nl-NL");
  const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString("nl-NL") : null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.row}>
          <View>
            <Text style={styles.h1}>{brandName}</Text>
            <Text style={[styles.muted, { marginTop: 2 }]}>Factuur</Text>
            <Text style={[styles.h2, { marginTop: 6 }]}>{invoice.invoice_number}</Text>
          </View>

          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.muted}>Datum: {invDate}</Text>
            {dueDate ? <Text style={styles.muted}>Vervaldatum: {dueDate}</Text> : null}
            <Text style={styles.muted}>Status: {invoice.status}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Addresses */}
        <View style={styles.row}>
          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.h2}>Van</Text>
            {sellerLines.length ? (
              sellerLines.map((l, idx) => <Text key={idx} style={{ marginTop: idx === 0 ? 6 : 2 }}>{l}</Text>)
            ) : (
              <Text style={[styles.muted, { marginTop: 6 }]}>Vul je bedrijfsgegevens in via Instellingen.</Text>
            )}
            {metaLeft.length ? (
              <View style={{ marginTop: 8 }}>
                {metaLeft.map((l, idx) => (
                  <Text key={idx} style={[styles.muted, { marginTop: idx === 0 ? 0 : 2 }]}>{l}</Text>
                ))}
              </View>
            ) : null}
          </View>

          <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.h2}>Aan</Text>
            {customer ? (
              <View style={{ marginTop: 6 }}>
                <Text style={{ fontWeight: "bold" }}>{customer.name}</Text>
                {customer.address ? <Text style={{ marginTop: 2 }}>{customer.address}</Text> : null}
                {customer.email ? <Text style={[styles.muted, { marginTop: 6 }]}>{customer.email}</Text> : null}
                {customer.phone ? <Text style={styles.muted}>{customer.phone}</Text> : null}
              </View>
            ) : (
              <Text style={[styles.muted, { marginTop: 6 }]}>Klant niet gevonden.</Text>
            )}
          </View>
        </View>

        {/* Items */}
        <View style={styles.tableHeader}>
          <Text style={[styles.colDesc, styles.th]}>Omschrijving</Text>
          <Text style={[styles.colQty, styles.th]}>Aantal</Text>
          <Text style={[styles.colPrice, styles.th]}>Prijs</Text>
          <Text style={[styles.colTotal, styles.th]}>Totaal</Text>
        </View>

        {items.length === 0 ? (
          <Text style={[styles.muted, { marginTop: 10 }]}>Geen regels.</Text>
        ) : (
          items.map((it, idx) => {
            const lineTotal = it.qty * it.unit_price;
            return (
              <View key={idx} style={styles.tr}>
                <View style={styles.colDesc}>
                  <Text style={{ fontWeight: "bold" }}>{it.description}</Text>
                  {it.unit ? <Text style={styles.muted}>Unit: {it.unit}</Text> : null}
                </View>
                <Text style={styles.colQty}>{it.qty.toString()}</Text>
                <Text style={styles.colPrice}>{money(it.unit_price, totals.currency)}</Text>
                <Text style={styles.colTotal}>{money(lineTotal, totals.currency)}</Text>
              </View>
            );
          })
        )}

        {/* Totals */}
        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>{totals.prices_include_vat ? "Subtotaal (incl.)" : "Subtotaal"}</Text>
            <Text style={{ fontWeight: "bold" }}>{money(totals.subtotal, totals.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>BTW ({totals.vat_rate}%)</Text>
            <Text style={{ fontWeight: "bold" }}>{money(totals.vat_amount, totals.currency)}</Text>
          </View>
          <View style={[styles.totalsRow, { marginTop: 8 }]}>
            <Text style={{ fontWeight: "bold", fontSize: 12 }}>Totaal</Text>
            <Text style={{ fontWeight: "bold", fontSize: 12 }}>{money(totals.total, totals.currency)}</Text>
          </View>
          <View style={[styles.card, { marginTop: 12 }]}>
  <Text style={styles.h2}>Betaling</Text>
  <Text style={{ marginTop: 6 }}>
    Graag betalen op IBAN: {seller.iban ?? "—"}
  </Text>
  <Text style={{ marginTop: 2 }}>
    O.v.v. {invoice.invoice_number}
  </Text>
  {dueDate ? <Text style={{ marginTop: 2 }}>Vervaldatum: {dueDate}</Text> : null}
</View>

        </View>

        {/* Notes / Footer */}
        {invoice.notes ? (
          <View style={[styles.card, { marginTop: 16 }]}>
            <Text style={styles.h2}>Notities</Text>
            <Text style={{ marginTop: 6 }}>{invoice.notes}</Text>
          </View>
        ) : null}

        {invoice.footer ? (
          <View style={[styles.card, { marginTop: 10 }]}>
            <Text style={styles.h2}>Footer</Text>
            <Text style={{ marginTop: 6 }}>{invoice.footer}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
