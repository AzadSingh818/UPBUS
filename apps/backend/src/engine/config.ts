// config.ts
export const DIVERGENCE_PROXIMITY_KM = 0.5; // distance to start checking for branch match
export const BRANCH_MATCH_MARGIN_KM = 0.4; // max perpendicular distance to consider a match
export const BRANCH_CONFIDENCE_MS = 30_000; // 30 s sustained proximity
export const AMBIGUITY_TIMEOUT_MS = 15_000; // abort ambiguous crossing after 15 s
