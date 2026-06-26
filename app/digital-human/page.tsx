"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DigitalHumanRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/shoot-room"); }, [router]);
  return <div className="flex min-h-screen items-center justify-center text-[13px] text-[#8A8A86]">正在跳转到拍摄作战室…</div>;
}
