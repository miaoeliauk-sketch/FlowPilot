"use client";

import { useEffect } from "react";
import { hasExpectedShikongTopicCalibrationSamples, upsertShikongTopicCalibrationSamples } from "@/lib/topic-calibration-store";

export function TopicCalibrationSeeder({ targetIPId }: { targetIPId?: string }) {
  useEffect(() => {
    if (!targetIPId) return;
    if (hasExpectedShikongTopicCalibrationSamples(targetIPId)) return;
    upsertShikongTopicCalibrationSamples(targetIPId);
  }, [targetIPId]);

  return null;
}
