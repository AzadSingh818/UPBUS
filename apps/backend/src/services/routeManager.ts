import { query } from '../db';

/**
 * Service to manage Routes using Multi-Version Concurrency Control (MVCC)
 * Ensures that live routes are never modified directly, preventing crashes for active buses.
 */
export class RouteManager {
  /**
   * Fetches the currently active version of a route by its code.
   */
  static async getActiveRoute(routeCode: string): Promise<any> {
    const res = await query(
      `SELECT * FROM routes WHERE route_code = $1 AND is_active = TRUE LIMIT 1`,
      [routeCode]
    );
    return res.rows[0] || null;
  }

  /**
   * Modifies an existing route by creating a new version (V_next) in the background.
   * Active buses will continue using the old version until the new one is explicitly promoted.
   */
  static async createRouteDraft(routeCode: string, newMetadata: any, newSegments: any[]): Promise<number> {
    const activeRoute = await this.getActiveRoute(routeCode);
    if (!activeRoute) {
      throw new Error(`Route ${routeCode} not found.`);
    }

    const nextVersion = activeRoute.version_id + 1;

    // 1. Create a draft version of the route
    const insertRes = await query(
      `INSERT INTO routes (route_code, route_name, source, destination, distance_km, version_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id`,
      [
        routeCode,
        newMetadata.route_name || activeRoute.route_name,
        newMetadata.source || activeRoute.source,
        newMetadata.destination || activeRoute.destination,
        newMetadata.distance_km || activeRoute.distance_km,
        nextVersion
      ]
    );

    const newRouteId = insertRes.rows[0].id;

    // 2. Insert new route_manifest mapping
    for (let i = 0; i < newSegments.length; i++) {
      const segmentId = newSegments[i].segment_id;
      await query(
        `INSERT INTO route_manifest (route_id, segment_id, sequence_no) VALUES ($1, $2, $3)`,
        [newRouteId, segmentId, i + 1]
      );
    }

    return newRouteId;
  }

  /**
   * Promotes a draft route to active. Deprecates the old version.
   * This should typically be run during zero-traffic windows (e.g., midnight).
   */
  static async promoteRouteVersion(routeCode: string, targetVersion: number): Promise<void> {
    // Start Transaction
    await query('BEGIN');
    try {
      // Deprecate all versions
      await query(`UPDATE routes SET is_active = FALSE WHERE route_code = $1`, [routeCode]);

      // Promote the specific version
      const res = await query(`UPDATE routes SET is_active = TRUE WHERE route_code = $1 AND version_id = $2`, [routeCode, targetVersion]);
      
      if (res.rowCount === 0) {
        throw new Error(`Route ${routeCode} version ${targetVersion} does not exist.`);
      }

      await query('COMMIT');
    } catch (e) {
      await query('ROLLBACK');
      throw e;
    }
  }
}
