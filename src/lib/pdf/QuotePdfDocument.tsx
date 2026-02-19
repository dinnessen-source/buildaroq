import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

type QuoteStatus = "draft" | "sent" | "accepted" | "declined";

export type QuotePdfData = {
  brandName: string;

  quote: {
    id: string;
    quote_number: string;
    status: QuoteStatus;
    notes: string | null;
    footer: string | null;
    created_at: string;
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

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: "Helvetica" },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  brand: { fontSize: 18, fontWeight: 700 },
  meta: { fontSize: 11, color: "#333" },

  section: { marginTop: 10, marginBottom: 10 },
  h2: { fontSize: 12, fontWeight: 700, marginBottom: 6 },

  gridRow: { flexDirection: "row", gap: 16 },
  box: { flex: 1 },

  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#DDD",
    paddingBottom: 6,
    marginTop: 10,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
    paddingVertical: 6,
  },
  colDesc: { width: "56%" },
  colQty: { width: "12%", textAlign: "right" },
  colUnit: { width: "10%", textAlign: "right" },
  colUnitPrice: { width: "11%", textAlign: "right" },
  colTotal: { width: "11%", textAlign: "right" },

  totals: { marginTop: 12, alignItems: "flex-end" },
  totalLine: {
    flexDirection: "row",
    width: 240,
    justifyContent: "space-between",
    marginTop: 4,
  },

  muted: { color: "#666" },
  small: { fontSize: 10, color: "#555" },
});

function money(value: number, currency: string) {
  // Simpel en stabiel: geen Intl dependency in PDF runtime
  const n = Number.isFinite(value) ? value : 0;
  const formatted = n.toFixed(2);
  const symbol = currency === "EUR" ? "€" : currency + " ";
  return `${symbol} ${formatted}`;
}

function safeLine(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function QuotePdfDocument({ data }: { data: QuotePdfData }) {
  const { quote, seller, customer, items, totals, brandName } = data;

  const dateStr = new Date(quote.created_at).toLocaleDateString("nl-NL");
  const statusStr = quote.status.toUpperCase();

  const sellerAddressLines = [
    seller.company_name,
    safeLine(seller.address_line1, seller.address_line2),
    safeLine(seller.postal_code, seller.city),
    seller.country,
  ].filter((x) => x && x.trim() !== "");

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.brand}>{brandName}</Text>
            <Text style={styles.small}>{seller.company_name ?? ""}</Text>
          </View>
          <View>
            <Text style={styles.meta}>Offerte: {quote.quote_number}</Text>
            <Text style={styles.meta}>Datum: {dateStr}</Text>
            <Text style={styles.meta}>Status: {statusStr}</Text>
          </View>
        </View>

        {/* Seller / Customer */}
        <View style={[styles.section, styles.gridRow]}>
          <View style={styles.box}>
            <Text style={styles.h2}>Van</Text>
            {sellerAddressLines.length ? (
              sellerAddressLines.map((line, idx) => (
                <Text key={idx}>{line}</Text>
              ))
            ) : (
              <Text style={styles.muted}>—</Text>
            )}
            {seller.company_email ? <Text>{seller.company_email}</Text> : null}
            {seller.phone ? <Text>{seller.phone}</Text> : null}
            {seller.vat_number ? <Text>BTW: {seller.vat_number}</Text> : null}
            {seller.chamber_of_commerce ? (
              <Text>KvK: {seller.chamber_of_commerce}</Text>
            ) : null}
            {seller.iban ? <Text>IBAN: {seller.iban}</Text> : null}
          </View>

          <View style={styles.box}>
            <Text style={styles.h2}>Aan</Text>
            {customer ? (
              <>
                <Text>{customer.name}</Text>
                {customer.email ? <Text>{customer.email}</Text> : null}
                {customer.phone ? <Text>{customer.phone}</Text> : null}
                {customer.address ? (
                  <Text style={styles.small}>{customer.address}</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.muted}>Klant niet gevonden</Text>
            )}
          </View>
        </View>

        {/* Items */}
        <View style={styles.section}>
          <Text style={styles.h2}>Regels</Text>

          <View style={styles.tableHeader}>
            <Text style={styles.colDesc}>Omschrijving</Text>
            <Text style={styles.colQty}>Aantal</Text>
            <Text style={styles.colUnit}>Unit</Text>
            <Text style={styles.colUnitPrice}>Prijs</Text>
            <Text style={styles.colTotal}>Totaal</Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.row}>
              <Text style={styles.muted}>Geen regels</Text>
            </View>
          ) : (
            items.map((it, idx) => {
              const lineTotal = it.qty * it.unit_price;
              return (
                <View key={idx} style={styles.row}>
                  <Text style={styles.colDesc}>{it.description}</Text>
                  <Text style={styles.colQty}>{it.qty}</Text>
                  <Text style={styles.colUnit}>{it.unit ?? "—"}</Text>
                  <Text style={styles.colUnitPrice}>
                    {money(it.unit_price, totals.currency)}
                  </Text>
                  <Text style={styles.colTotal}>
                    {money(lineTotal, totals.currency)}
                  </Text>
                </View>
              );
            })
          )}

          {/* Totals */}
          <View style={styles.totals}>
            <View style={styles.totalLine}>
              <Text style={styles.muted}>
                {totals.prices_include_vat ? "Subtotaal (incl.)" : "Subtotaal"}
              </Text>
              <Text>{money(totals.subtotal, totals.currency)}</Text>
            </View>

            <View style={styles.totalLine}>
              <Text style={styles.muted}>BTW ({totals.vat_rate}%)</Text>
              <Text>{money(totals.vat_amount, totals.currency)}</Text>
            </View>

            <View style={styles.totalLine}>
              <Text style={{ fontWeight: 700 }}>Totaal</Text>
              <Text style={{ fontWeight: 700 }}>
                {money(totals.total, totals.currency)}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes */}
        {quote.notes ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Notities</Text>
            <Text>{quote.notes}</Text>
          </View>
        ) : null}

        {/* Footer */}
        {quote.footer ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Footer</Text>
            <Text>{quote.footer}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}
