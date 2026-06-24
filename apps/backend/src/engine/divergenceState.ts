// divergenceState.ts
// In‑memory store tracking per‑bus divergence matching state
import { DIVERGENCE_PROXIMITY_KM, BRANCH_MATCH_MARGIN_KM, BRANCH_CONFIDENCE_MS, AMBIGUITY_TIMEOUT_MS } from './config';

export type DivergencePhase = 'PRE' | 'CROSSING' | 'CONFIRMED' | 'COMPLETED';

export interface BusDivergenceState {
  busId: string; // registration number or internal id
  routeId: number;
  nodeId?: string; // current divergence node id if within proximity
  matchedBranch?: string;
  phase: DivergencePhase;
  lastMatchTimestamp?: number; // ms epoch when branch was within margin
  crossingStart?: number; // ms epoch when entered proximity
}

// Map keyed by busId
const stateMap = new Map<string, BusDivergenceState>();

export function getState(busId: string): BusDivergenceState | undefined {
  return stateMap.get(busId);
}

export function setState(state: BusDivergenceState): void {
  stateMap.set(state.busId, state);
}

/** Reset state for a bus (e.g., when trip ends) */
export function clearState(busId: string): void {
  stateMap.delete(busId);
}
