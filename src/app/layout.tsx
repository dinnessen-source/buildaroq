import "./globals.css";

export const metadata = {
  title: "BuildaroQ",
  description: "SaaS for Craftsmen",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
