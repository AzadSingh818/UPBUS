import { GPSValidator, GPSPacket } from '../algorithms/GPSValidator';
import { NoiseFilter } from '../algorithms/NoiseFilter';
import { MapMatcher } from '../algorithms/MapMatcher';
import { SegmentDetector } from '../algorithms/SegmentDetector';
import { StopStateMachine, StopState } from '../algorithms/StopStateMachine';
import { CompletedStopEngine } from '../algorithms/CompletedStopEngine';
import { RemainingStopEngine } from '../algorithms/RemainingStopEngine';
import { ReverseDetector } from '../algorithms/ReverseDetector';
import { RouteDeviationDetector } from '../algorithms/RouteDeviationDetector';
import { DirectionLockEngine } from '../algorithms/DirectionLockEngine';
import { CacheBuilder, ProgressResult } from '../algorithms/CacheBuilder';
import { RouteProgressRepository } from '../repository/RouteProgressRepository';
// import { ProgressSocketHandler } from '../socket/ProgressSocketHandler';
import { adminMonitor } from '../../../services/adminMonitor';

export class RouteProgressEngine {
  static async process(gpsPacket: GPSPacket): Promise<ProgressResult | null> {
    const { busId, latitude, longitude, speed, heading, accuracy } = gpsPacket;

    console.log(`[RouteProgressEngine] Processing ping for bus ${busId}: (${latitude}, ${longitude})`);
    adminMonitor.addLog({
      terminalId: 'engine',
      service: 'GEO-MATCH',
      level: 'INFO',
      type: 'LEARNING',
      busId,
      entityId: `BUS-${busId}`,
      message: `Ingested raw telemetry packet (Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}, Speed: ${Math.round(speed)}km/h)`
    });

    // Fetch trip details to identify the assigned route
    const trip = await RouteProgressRepository.getTripForBus(busId);
    if (trip) {
      adminMonitor.updateBus(busId, trip.registration_no, {
        latitude,
        longitude,
        speed,
        heading,
        routeCode: (trip as any).route_code ?? `R_${trip.route_id}`,
        routeName: trip.route_name,
        status: 'TRACKED'
      });
    }

    // 1. GPS Ingest Validation
    const isValid = GPSValidator.validate(gpsPacket);
    if (!isValid) {
      console.warn(`[RouteProgressEngine] GPS packet validation failed for bus ${busId}`);
      return null;
    }

    // 2. Noise Filter
    const passNoiseFilter = NoiseFilter.filter(gpsPacket);
    if (!passNoiseFilter) {
      console.warn(`[RouteProgressEngine] GPS packet noise filter rejected for bus ${busId}`);
      return null;
    }

    if (!trip) {
      console.warn(`[RouteProgressEngine] No active running trip found for bus ${busId}`);
      return null;
    }

    const routeId = trip.route_id;
    const tripId = trip.id;

    // Load cached stops for this route
    const routeStops = await RouteProgressRepository.getRouteStops(routeId);
    if (routeStops.length === 0) {
      console.warn(`[RouteProgressEngine] No stops found for route ${routeId}`);
      return null;
    }

    // Fetch previous stop visit logs and previous cached progress (before updating database with new GPS coordinates)
    const lastProgress = await RouteProgressRepository.getLastProgress(busId);
    const visitLogs = await RouteProgressRepository.getStopVisitLogs(busId);
    const visitedStopIds = new Set(visitLogs.filter(l => l.visited).map(l => l.stop_id));

    const lastCoveredDistance = lastProgress ? lastProgress.covered_distance : 0;
    const lastHeading = lastProgress ? lastProgress.heading || 0 : heading;

    // 3. Upsert live location
    await RouteProgressRepository.upsertLiveLocation(busId, latitude, longitude, heading, speed, accuracy);

    // 4. Map Matching
    const matched = MapMatcher.match(latitude, longitude, routeStops);
    const { matchedLatitude, matchedLongitude, coveredDistance } = matched;

    // 5. Current Segment Detection
    const segment = SegmentDetector.detect(coveredDistance, routeStops);

    // 6. Reverse Travel & Rollback detection
    const isReversing = ReverseDetector.isReversing(lastCoveredDistance, coveredDistance, lastHeading, heading, speed);
    let stateMachineRollbackAllowed = false;
    let overallBusState = 'BETWEEN_STOPS';

    if (isReversing) {
      overallBusState = 'REVERSING';
      stateMachineRollbackAllowed = true;
      adminMonitor.addLog({
        type: 'VALIDATION',
        busId,
        message: `Reverse travel detected for bus ${busId}. Rollback allowed.`
      });
    }

    // 7. Evaluate Stop State Machine for each stop
    const evaluatedStops: { stopId: number; stopName: string; sequence: number; state: StopState }[] = [];
    for (const stop of routeStops) {
      const stopId = stop.id;
      let isVisited = visitedStopIds.has(stopId);

      // Reconstruct the stop's current state
      let currentStopState: StopState = 'NOT_REACHED';
      if (isVisited) {
        currentStopState = 'COMPLETED';
      } else {
        // If we backed into or passed the stop, check if we need to rollback
        if (lastProgress && stateMachineRollbackAllowed && coveredDistance < stop.distance_from_start) {
          await RouteProgressRepository.rollbackStopVisit(stopId, busId);
          visitedStopIds.delete(stopId);
          isVisited = false;
          currentStopState = 'NOT_REACHED';
        } else {
          // Reconstruct state based on distance
          const distToStop = stop.distance_from_start - coveredDistance;
          if (distToStop > 500) {
            currentStopState = 'NOT_REACHED';
          } else if (distToStop > 100) {
            currentStopState = 'APPROACHING';
          } else if (coveredDistance <= stop.distance_from_start) {
            currentStopState = 'AT_STOP';
          } else if (coveredDistance <= stop.distance_from_start + 120) {
            currentStopState = 'DEPARTING';
          } else {
            currentStopState = 'COMPLETED';
          }
        }
      }

      // Run state machine evaluation
      const evalResult = StopStateMachine.evaluate(
        coveredDistance,
        {
          stopId: stop.id,
          stopName: stop.stop_name,
          distanceFromStart: stop.distance_from_start,
          sequence: stop.sequence
        },
        currentStopState,
        isVisited
      );

      // Handle Visit Log changes
      if (evalResult.shouldLogArrival) {
        await RouteProgressRepository.logStopArrival(stopId, busId, new Date());
      }
      if (evalResult.shouldLogDeparture) {
        await RouteProgressRepository.logStopDeparture(stopId, busId, new Date());
        visitedStopIds.add(stopId); // Add to local visited set
      }

      evaluatedStops.push({
        stopId,
        stopName: stop.stop_name,
        sequence: stop.sequence,
        state: evalResult.state
      });
    }

    // 8. Completed Stop list & last completed stop index
    const completedStops = CompletedStopEngine.getCompletedStops(evaluatedStops);
    const lastCompletedIdx = CompletedStopEngine.getLastCompletedStopIndex(evaluatedStops);

    // 9. Remaining Stop list
    const remainingStops = RemainingStopEngine.getRemainingStops(
      coveredDistance,
      evaluatedStops.map(es => {
        const routeStop = routeStops.find(rs => rs.id === es.stopId)!;
        return {
          stopId: es.stopId,
          stopName: es.stopName,
          distanceFromStart: routeStop.distance_from_start,
          sequence: es.sequence,
          state: es.state
        };
      })
    );

    // 10. Route Deviation Check
    const isDeviated = RouteDeviationDetector.isDeviated(latitude, longitude, matchedLatitude, matchedLongitude, 150);
    let routeStatus = isDeviated ? 'OFF_ROUTE' : 'ON_ROUTE';

    // 11. Wrong Direction Lock Check
    const fromStopObj = routeStops.find(rs => rs.stop_name === segment.fromStopName);
    const toStopObj = routeStops.find(rs => rs.stop_name === segment.toStopName);
    if (fromStopObj && toStopObj && routeStatus !== 'OFF_ROUTE') {
      const isWrongDir = DirectionLockEngine.isWrongDirection(heading, fromStopObj, toStopObj, speed);
      if (isWrongDir) {
        routeStatus = 'WRONG_DIRECTION';
      }
    }

    // Determine current overall bus state
    let currentStop: string | null = null;
    if (routeStatus === 'OFF_ROUTE') {
      overallBusState = 'OFF_ROUTE';
    } else if (isReversing) {
      overallBusState = 'REVERSING';
    } else if (routeStatus === 'WRONG_DIRECTION') {
      overallBusState = 'WRONG_DIRECTION';
    } else {
      const stopAtHand = evaluatedStops.find(es => es.state === 'AT_STOP');
      if (stopAtHand) {
        overallBusState = 'AT_STOP';
        currentStop = stopAtHand.stopName;
      } else if (lastCompletedIdx === routeStops.length - 1) {
        overallBusState = 'ROUTE_COMPLETED';
        // Bus has finished its route — remove from active tracking immediately
        adminMonitor.removeBus(busId);
      } else {
        overallBusState = 'BETWEEN_STOPS';
      }
    }

    // 12. Build and Save Cache (and return final result)
    const totalDistance = routeStops[routeStops.length - 1].distance_from_start;
    const progressResult = await CacheBuilder.buildAndSave(
      busId,
      coveredDistance,
      totalDistance,
      overallBusState,
      { from: segment.fromStopName, to: segment.toStopName },
      completedStops,
      remainingStops,
      lastCompletedIdx,
      currentStop
    );

    // 13. Socket Emit (BUS_PROGRESS_UPDATED)
    // ProgressSocketHandler.broadcast(busId, progressResult);

    adminMonitor.updateBus(busId, trip.registration_no, {
      latitude,
      longitude,
      speed,
      heading,
      routeCode: (trip as any).route_code ?? `R_${trip.route_id}`,
      routeName: trip.route_name,
      currentStop: currentStop || `${segment.fromStopName} ➔ ${segment.toStopName}`,
      status: overallBusState
    });

    return progressResult;
  }
}
