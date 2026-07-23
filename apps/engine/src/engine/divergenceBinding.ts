// divergenceBinding.ts
import { loadDivergenceNodes, DivergenceNode, DivergenceBranch } from './divergenceNode';
import { distanceToPolylineKm } from './geoUtils';
import { DIV_DISTANCE_THRESHOLD_KM } from './divergenceConfig';

// Cache loaded nodes for fast lookup
export let divergenceCache: DivergenceNode[] = [];

/** Initialize divergence node cache – call once at server start */
export function initDivergenceCache() {
  divergenceCache = loadDivergenceNodes();
  console.log(`[Divergence] Loaded ${divergenceCache.length} divergence nodes`);
}

/**
 * Determine which branch a bus matches at a given divergence node.
 * Returns the matching DivergenceBranch or null if none within threshold.
 */
export function matchBranchForBus(
  busLat: number,
  busLng: number,
  nodeId: number
): DivergenceBranch | null {
  const node = divergenceCache.find(n => n.id === nodeId);
  if (!node) return null;
  for (const branch of node.branches) {
    const dist = distanceToPolylineKm({ lat: busLat, lng: busLng }, branch.polyline);
    if (dist <= DIV_DISTANCE_THRESHOLD_KM) {
      return branch;
    }
  }
  return null;
}
