// divergenceNode.ts
import { DIV_DISTANCE_THRESHOLD_KM } from './divergenceConfig'; // may be used elsewhere

export interface DivergenceBranch {
  branchId: number; // unique within this node
  routeIds: number[]; // routes that follow this branch
  polyline: { lat: number; lng: number }[]; // ordered points from node onward
}

export interface DivergenceNode {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  branches: DivergenceBranch[];
}

/** Load divergence nodes from the mock DB (data.json). */
export function loadDivergenceNodes(): DivergenceNode[] {
  // Dynamically require to avoid circular dependencies
  const mockDb = require('../db/data.json');
  return (mockDb as any).divergence_nodes || [];
}
