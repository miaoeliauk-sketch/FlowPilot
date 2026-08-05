import type { IPProfile } from "./types";

export function buildTopicReviewRequestPayload<T extends object>(
  payload: T,
  activeIP: IPProfile | null,
): T & { ipProfile: IPProfile | undefined } {
  return {
    ...payload,
    ipProfile: activeIP ?? undefined,
  };
}
