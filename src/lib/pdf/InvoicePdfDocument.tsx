import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

type VatBreakdownRow = {
  rate: number; // 0, 9, 21, ...
  base: number; // grondslag
  vat: number;  // btw-bedrag
};

export type InvoicePdfData = {
  brandName: string;

  // ✅ data-uri vanuit je invoice route.ts (zelfde als quote)
  logoDataUri?: string | null;

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
    vat_type?: string | null;
    vat_rate?: number | null;
  }>;

  totals: {
    currency: string;
    prices_include_vat: boolean;
    vat_rate?: number; // fallback
    subtotal: number;
    vat_amount: number;
    total: number;
    vat_breakdown?: VatBreakdownRow[];
    notices?: string[];
  };
};

/* =========================================================
   🔧 LOGO INSTELLINGEN – HIER AANPASSEN (zelfde als Quote)
   ========================================================= */
const LOGO_WIDTH = 340;
const LOGO_HEIGHT = 80;
const LOGO_OFFSET_LEFT = -6;

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingHorizontal: 32,
    paddingBottom: 64,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#000",
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
    alignItems: "flex-start",
  },

  logo: {
    width: LOGO_WIDTH,
    height: LOGO_HEIGHT,
    marginLeft: LOGO_OFFSET_LEFT,
    objectFit: "contain",
  },

  brandFallback: { fontSize: 18, fontWeight: 700, color: "#000" },

  meta: {
    fontSize: 11,
    color: "#000",
    lineHeight: 1.35,
    textAlign: "right",
  },

  section: { marginTop: 10, marginBottom: 10 },

  h2: { fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#000" },

  gridRow: { flexDirection: "row", gap: 16 },
  box: { flex: 1 },

  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingBottom: 6,
    marginTop: 10,
  },

  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#DDD",
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

  noticeBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#DDD",
  },

  footer: {
    position: "absolute",
    left: 32,
    right: 32,
    bottom: 20,
    fontSize: 10.5,
    color: "#000",
  },
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function money(value: number, currency: string) {
  const n = Number.isFinite(value) ? value : 0;
  const formatted = n.toFixed(2);
  const symbol = currency === "EUR" ? "€" : currency + " ";
  return `${symbol} ${formatted}`;
}

function safeLine(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDateNL(iso: string) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function formatDateOnlyNL(date: string) {
  const d = new Date(`${date}T00:00:00`);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function InvoicePdfDocument({ data }: { data: InvoicePdfData }) {
  const { invoice, seller, customer, items, totals, brandName, logoDataUri } = data;

  const invDate = formatDateNL(invoice.created_at);
  const dueDate = invoice.due_date ? formatDateOnlyNL(invoice.due_date) : null;
  const statusStr = String(invoice.status ?? "").toUpperCase();

  const sellerAddressLines = [
    seller.company_name,
    safeLine(seller.address_line1, seller.address_line2),
    safeLine(seller.postal_code, seller.city),
    seller.country,
  ].filter((x) => x && x.trim() !== "");

  const breakdown = (totals.vat_breakdown ?? []).filter((r) => r && Number.isFinite(r.rate));
  const breakdownNonZero = breakdown.filter((r) => round2(r.rate) !== 0);
  const notices = totals.notices ?? [];

  // ✅ key: force remount als logo verandert (React-PDF cache workaround)
  const logoKey = logoDataUri ? logoDataUri.slice(0, 120) : "no-logo";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            {logoDataUri ? (
              <Image key={logoKey} src={logoDataUri} style={styles.logo} />
            ) : (
              <Text style={styles.brandFallback}>{brandName}</Text>
            )}
          </View>

          <View>
            <Text style={styles.meta}>Factuur: {invoice.invoice_number}</Text>
            <Text style={styles.meta}>Datum: {invDate}</Text>
            {dueDate ? <Text style={styles.meta}>Vervaldatum: {dueDate}</Text> : null}
            <Text style={styles.meta}>Status: {statusStr}</Text>
          </View>
        </View>

        {/* Seller / Customer */}
        <View style={[styles.section, styles.gridRow]}>
          <View style={styles.box}>
            <Text style={styles.h2}>Van</Text>
            {sellerAddressLines.length ? (
              sellerAddressLines.map((line, idx) => <Text key={idx}>{line}</Text>)
            ) : (
              <Text>—</Text>
            )}
            {seller.company_email ? <Text>{seller.company_email}</Text> : null}
            {seller.phone ? <Text>{seller.phone}</Text> : null}
            {seller.vat_number ? <Text>BTW: {seller.vat_number}</Text> : null}
            {seller.chamber_of_commerce ? <Text>KvK: {seller.chamber_of_commerce}</Text> : null}
            {seller.iban ? <Text>IBAN: {seller.iban}</Text> : null}
          </View>

          <View style={styles.box}>
            <Text style={styles.h2}>Aan</Text>
            {customer ? (
              <>
                <Text>{customer.name}</Text>
                {customer.email ? <Text>{customer.email}</Text> : null}
                {customer.phone ? <Text>{customer.phone}</Text> : null}
                {customer.address ? <Text>{customer.address}</Text> : null}
              </>
            ) : (
              <Text>Klant niet gevonden</Text>
            )}
          </View>
        </View>

        {/* Items */}
        <View style={styles.section}>
          <View style={styles.tableHeader}>
            <Text style={styles.colDesc}>Omschrijving</Text>
            <Text style={styles.colQty}>Aantal</Text>
            <Text style={styles.colUnit}>Unit</Text>
            <Text style={styles.colUnitPrice}>Prijs</Text>
            <Text style={styles.colTotal}>Totaal</Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.row}>
              <Text>Geen regels</Text>
            </View>
          ) : (
            items.map((it, idx) => {
              const lineTotal = it.qty * it.unit_price;
              return (
                <View key={idx} style={styles.row}>
                  <Text style={styles.colDesc}>{it.description}</Text>
                  <Text style={styles.colQty}>{it.qty}</Text>
                  <Text style={styles.colUnit}>{it.unit ?? "—"}</Text>
                  <Text style={styles.colUnitPrice}>{money(it.unit_price, totals.currency)}</Text>
                  <Text style={styles.colTotal}>{money(lineTotal, totals.currency)}</Text>
                </View>
              );
            })
          )}

          {/* Totals */}
          <View style={styles.totals}>
            <View style={styles.totalLine}>
              <Text>Subtotaal</Text>
              <Text>{money(totals.subtotal, totals.currency)}</Text>
            </View>

            {breakdownNonZero.length > 0 ? (
              breakdownNonZero.map((r) => (
                <View key={`vat-${r.rate}`} style={styles.totalLine}>
                  <Text>BTW ({round2(r.rate)}%)</Text>
                  <Text>{money(r.vat, totals.currency)}</Text>
                </View>
              ))
            ) : (
              <View style={styles.totalLine}>
                <Text>BTW ({Number.isFinite(totals.vat_rate) ? totals.vat_rate : 0}%)</Text>
                <Text>{money(totals.vat_amount, totals.currency)}</Text>
              </View>
            )}

            <View style={styles.totalLine}>
              <Text style={{ fontWeight: 700 }}>Totaal</Text>
              <Text style={{ fontWeight: 700 }}>{money(totals.total, totals.currency)}</Text>
            </View>
          </View>

          {/* Notices */}
          {notices.length > 0 ? (
            <View style={styles.noticeBox}>
              {notices.map((n, i) => (
                <Text key={i} style={{ fontSize: 10 }}>
                  {n}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        {/* Notes */}
        {invoice.notes ? (
          <View style={styles.section}>
            <Text style={styles.h2}>Notities</Text>
            <Text>{invoice.notes}</Text>
          </View>
        ) : null}

        {/* Footer */}
        {invoice.footer ? <Text style={styles.footer}>{invoice.footer}</Text> : null}
      </Page>
    </Document>
  );
}