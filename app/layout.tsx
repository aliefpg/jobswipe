import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "JobSwipe",
  description: "Seleksi lowongan pekerjaan bersama"
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}
