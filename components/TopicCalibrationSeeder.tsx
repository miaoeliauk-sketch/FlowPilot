"use client";

import { useEffect } from "react";
import { hasExpectedShikongTopicCalibrationSamples, upsertShikongTopicCalibrationSamples } from "@/lib/topic-calibration-store";

export function TopicCalibrationSeeder() {
  useEffect(() => {
    if (hasExpectedShikongTopicCalibrationSamples()) return;
    upsertShikongTopicCalibrationSamples();
  }, []);

  return null;
}
