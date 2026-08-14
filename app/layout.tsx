import type { Metadata } from "next";
import "./globals.css";
import AppLayout from "@/components/layout/AppLayout";
import { IPProvider } from "@/lib/ip-context";
import { LocalDataSync } from "@/components/LocalDataSync";
import { isLocalSyncEnabled } from "@/lib/local-sync-contract";

export const metadata: Metadata = {
  title: "AI IP 操盘工作台",
  description: "AI+IP 内容创作者的一体化工作台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const localSyncEnabled = isLocalSyncEnabled();

  return (
    <html lang="zh-CN">
      <body>
        <IPProvider>
          {localSyncEnabled ? <LocalDataSync /> : null}
          <AppLayout>{children}</AppLayout>
        </IPProvider>
      </body>
    </html>
  );
}
