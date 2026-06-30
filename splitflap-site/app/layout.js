import "./globals.css";

export const metadata = {
  title: "Split-Flap Controller",
  description: "Manage messages pushed to split-flap sign boards.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
