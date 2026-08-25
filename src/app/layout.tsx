import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClipMint AI · Video affiliate trong vài phút",
  description: "Biến video sản phẩm thô thành video affiliate ngắn ngay trên máy của bạn.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}

