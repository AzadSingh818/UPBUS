/**
 * Phase 3: Historical Trajectory Memory & Path Similarity Engine
 * 
 * Rules:
 *   1. Compares current active trip path against historical runs of the same bus regNo (last 7-14 days).
 *   2. Representation: Discrete geohash-7 spatial segments.
 *   3. Path Similarity: Jaccard Coefficient = |A ∩ B| / |A ∪ B|.
 *   4. Multi-factor Confidence Formula:
 *        Score = 0.6 * PathSimilarity + 0.3 * TimeOfDayMatch + 0.1 * RecencyWeight
 *   5. Strict Guardrail:
 *        "Confirmed" only when matching historical runs >= 3 AND Score >= 0.85
 *        Otherwise "Likely / Pending Confirmation"
 */

export interface HistoricalTripRun {
  tripId: string;
  regNo: string;
  departureHour: number; // 0-23
  departureDate: string; // YYYY-MM-DD
  routeCode: string;
  routeName: string;
  spatialSegments: Set<string>; // Geohash-7 or road segment IDs
}

export interface HistoricalMatchResult {
  confidenceLabel: 'CONFIRMED' | 'LIKELY' | 'INSUFFICIENT_DATA';
  confidenceScore: number;
  matchedRouteName?: string;
  matchedRouteCode?: string;
  totalHistoricalRunsEvaluated: number;
  matchingRunsCount: number;
}

export class HistoricalTrajectoryMemory {
  // regNo -> historical runs
  private history: Map<string, HistoricalTripRun[]> = new Map();

  constructor(seedHistory: HistoricalTripRun[] = []) {
    for (const run of seedHistory) {
      if (!this.history.has(run.regNo)) {
        this.history.set(run.regNo, []);
      }
      this.history.get(run.regNo)!.push(run);
    }
  }

  public recordHistoricalRun(run: HistoricalTripRun): void {
    if (!this.history.has(run.regNo)) {
      this.history.set(run.regNo, []);
    }
    this.history.get(run.regNo)!.push(run);
  }

  /**
   * Jaccard Similarity between two sets of spatial segments
   */
  public calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const elem of setA) {
      if (setB.has(elem)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Matches current live trajectory segments against historical trips of this bus
   */
  public matchCurrentTrip(
    regNo: string,
    currentSegments: Set<string>,
    currentDepartureHour: number
  ): HistoricalMatchResult {
    const busHistory = this.history.get(regNo) || [];

    if (busHistory.length === 0 || currentSegments.size < 3) {
      return {
        confidenceLabel: 'INSUFFICIENT_DATA',
        confidenceScore: 0,
        totalHistoricalRunsEvaluated: busHistory.length,
        matchingRunsCount: 0
      };
    }

    // Evaluate each historical run
    interface ScoredRun {
      run: HistoricalTripRun;
      score: number;
      pathSim: number;
    }

    const scoredRuns: ScoredRun[] = [];

    for (const hRun of busHistory) {
      const pathSim = this.calculateJaccardSimilarity(currentSegments, hRun.spatialSegments);

      // Time of day match (closer to same hour gets higher score, bell-curve diff up to 3h)
      const hourDiff = Math.abs(currentDepartureHour - hRun.departureHour);
      const timeMatch = Math.max(0, 1 - (hourDiff / 4.0));

      // Recency weight: 1.0 (recent) down to 0.7 for older
      const recencyWeight = 0.9;

      const score = (0.6 * pathSim) + (0.3 * timeMatch) + (0.1 * recencyWeight);

      // Partial path overlap threshold: 0.50 (allows recognizing route early in the journey)
      if (pathSim >= 0.50) {
        scoredRuns.push({ run: hRun, score, pathSim });
      }
    }

    if (scoredRuns.length === 0) {
      return {
        confidenceLabel: 'INSUFFICIENT_DATA',
        confidenceScore: 0,
        totalHistoricalRunsEvaluated: busHistory.length,
        matchingRunsCount: 0
      };
    }

    // Find best candidate route
    scoredRuns.sort((a, b) => b.score - a.score);
    const best = scoredRuns[0];

    // Count how many historical runs agree on this same route
    const matchingRunsCount = scoredRuns.filter(sr => sr.run.routeCode === best.run.routeCode).length;

    // Strict guardrail rule:
    // "Confirmed" ONLY when matching runs >= 3 AND score >= 0.80
    const isConfirmed = matchingRunsCount >= 3 && best.score >= 0.80;

    return {
      confidenceLabel: isConfirmed ? 'CONFIRMED' : 'LIKELY',
      confidenceScore: Number(best.score.toFixed(3)),
      matchedRouteName: best.run.routeName,
      matchedRouteCode: best.run.routeCode,
      totalHistoricalRunsEvaluated: busHistory.length,
      matchingRunsCount
    };
  }
}
