import type { CopyIntegrationSource } from "./copy-integration-types";

export interface NormalizedContentShare {
  sourceId: string;
  weight: number;
  share: number;
  sharePercent: number;
}

export function getContentWeight(source: CopyIntegrationSource): number {
  return source.contentWeight ?? 1;
}

export function normalizeContentShares(sources: CopyIntegrationSource[]): NormalizedContentShare[] {
  const weights = sources.map(getContentWeight);
  const maxWeight = Math.max(...weights, 0);
  const scaledWeights = maxWeight > 0 ? weights.map(weight => weight / maxWeight) : weights.map(() => 0);
  const scaledTotal = scaledWeights.reduce((sum, weight) => sum + weight, 0);
  return sources.map((source, index) => ({
    sourceId: source.id,
    weight: weights[index],
    share: scaledTotal > 0 ? scaledWeights[index] / scaledTotal : 0,
    sharePercent: scaledTotal > 0 ? (scaledWeights[index] / scaledTotal) * 100 : 0,
  }));
}

export function formatContentShare(percent: number): string {
  const rounded = Math.round(percent * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}
