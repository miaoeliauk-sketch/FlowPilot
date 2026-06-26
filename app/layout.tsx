import type { Metadata } from "next";
import "./globals.css";
import AppLayout from "@/components/layout/AppLayout";
import { IPProvider } from "@/lib/ip-context";

export const metadata: Metadata = {
  title: "AI IP 操盘工作台",
  description: "AI+IP 内容创作者的一体化工作台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <IPProvider>
          <AppLayout>{children}</AppLayout>
        </IPProvider>
      </body>
    </html>
  );
}
