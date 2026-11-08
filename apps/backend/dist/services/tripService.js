"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TripService = void 0;
const db_1 = require("../db");
/**
 * Service to manage Trips using Optimistic Locking.
 * Prevents Data Concurrency issues (e.g. two dispatchers assigning a bus to a trip simultaneously).
 */
class TripService {
    /**
     * Assigns a vehicle to a scheduled trip safely using Optimistic Locking.
     *
     * @param tripId The ID of the trip
     * @param busId The ID of the bus to assign
     * @param currentVersion The version number the client expects the trip to be at
     * @returns boolean indicating success or failure due to concurrency
     */
    static async assignVehicleToTrip(tripId, busId, currentVersion) {
        // Atomic SQL Query with Optimistic Locking:
        // It will ONLY update if the status is still 'scheduled' AND the version matches what the client saw.
        const updateRes = await (0, db_1.query)(`UPDATE trips 
       SET bus_id = $1, status = 'running', version_number = version_number + 1
       WHERE id = $2 AND version_number = $3 AND status = 'scheduled'`, [busId, tripId, currentVersion]);
        if (updateRes.rowCount && updateRes.rowCount > 0) {
            return { success: true, message: `Successfully assigned bus ${busId} to trip ${tripId}.` };
        }
        // If 0 rows affected, either the trip ID doesn't exist, it's not scheduled, or someone else modified it.
        // Fetch the current state to return a helpful error message.
        const currentRes = await (0, db_1.query)(`SELECT status, version_number FROM trips WHERE id = $1`, [tripId]);
        if (!currentRes.rowCount || currentRes.rowCount === 0) {
            return { success: false, message: `Trip ${tripId} does not exist.` };
        }
        const currentState = currentRes.rows[0];
        if (currentState.status !== 'scheduled') {
            return { success: false, message: `Trip is no longer scheduled. Current status: ${currentState.status}.` };
        }
        if (currentState.version_number !== currentVersion) {
            return { success: false, message: `Concurrency error: Another operator modified this trip. Please refresh and try again.` };
        }
        return { success: false, message: `Failed to assign vehicle due to an unknown state change.` };
    }
    /**
     * Completes a trip safely.
     */
    static async completeTrip(tripId, currentVersion) {
        const updateRes = await (0, db_1.query)(`UPDATE trips 
       SET status = 'completed', version_number = version_number + 1
       WHERE id = $1 AND version_number = $2 AND status = 'running'`, [tripId, currentVersion]);
        if (updateRes.rowCount && updateRes.rowCount > 0) {
            return { success: true, message: `Trip ${tripId} marked as completed.` };
        }
        return { success: false, message: `Concurrency error or trip is not currently running.` };
    }
}
exports.TripService = TripService;
