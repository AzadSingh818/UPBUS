/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import dynamic from 'next/dynamic';
import {
  Search, MapPin, Clock, ArrowRight, Bus, Navigation,
  RotateCw, AlertCircle, ChevronDown, ChevronUp, Zap,
  ArrowLeftRight, Train, RefreshCcw
} from 'lucide-react';

const LiveMap = dynamic(() => import('./components/LiveMap'), { ssr: false });
import type { Village } from './components/LiveMap';

// ─── Types ──────────────────────────────────────────────────────────────────
interface ActiveTrip { trip_id: number; status: string; registration_no: string; bus_type: string; depot_name: string; routeCode?: string; }
interface MissedTrip extends TripLiveDetails { passedMinutesAgo: number; currentNextStop: string; }
interface NextTrip extends TripLiveDetails { etaToBoardingMinutes: number; currentNextStop?: string; }
interface Route { id: number; route_code: string; route_name: string; source: string; destination: string; distance_km: string; missedTrips: MissedTrip[]; nextTrips: NextTrip[]; stops: StopETA[]; }
interface StopETA { stopId: number; name: string; sequenceNo: number; latitude: number; longitude: number; distanceRemainingKm: number; etaMinutes: number; status: 'passed' | 'arriving_now' | 'arriving_soon' | 'on_stop' | 'upcoming'; }
interface TripLiveDetails { tripId: number; busRegNo: string; busType: string; routeCode: string; routeName: string; busLatitude: number; busLongitude: number; currentSpeedKmph: number; heading: number; lastSeen: string; status: string; stops: StopETA[]; error?: string; }
interface JourneyStop { stopId: number; name: string; latitude: number; longitude: number; sequenceNo: number; etaMinutes?: number; status?: string; }
interface JourneyLeg { routeId: number; routeName: string; routeCode: string; fromCity?: string; toCity?: string; from: string; to: string; distanceKm: number; durationMins: number; departureOffsetMins: number; arrivalOffsetMins: number; busInfo: { trip_id: number; registration_no: string; bus_type: string; depot_name: string; bus_latitude?: number | null; bus_longitude?: number | null; current_speed_kmph?: number; heading?: number; } | null; stops: JourneyStop[]; }
interface Journey { from: string; to: string; totalLegs: number; totalDistanceKm: number; totalDurationMins: number; legs: JourneyLeg[]; totalTransfers: number; message?: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtDuration = (mins: number) => {
  const h = Math.floor(mins / 60); const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtTime = (baseDate: Date, offsetMins: number) => {
  const d = new Date(baseDate.getTime() + offsetMins * 60000);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getCoreStopWord(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/\s+(bus station|bus stand|depot|terminal|isbt|peer|village)$/gi, '')
    .trim();
}

function getSegmentViaText(
  stops: { name: string; sequenceNo?: number }[],
  fromName: string,
  toName: string,
  rawRouteName?: string
): string {
  if (!stops || stops.length === 0 || !fromName || !toName) return '';

  const fromCore = getCoreStopWord(fromName);
  const toCore = getCoreStopWord(toName);

  if (!fromCore || !toCore) return '';

  let fromIdx = stops.findIndex(s => {
    const sCore = getCoreStopWord(s.name);
    return sCore.includes(fromCore) || fromCore.includes(sCore);
  });
  let toIdx = stops.findIndex(s => {
    const sCore = getCoreStopWord(s.name);
    return sCore.includes(toCore) || toCore.includes(sCore);
  });

  if (fromIdx === -1 || toIdx === -1) {
    if (fromIdx === -1) fromIdx = 0;
    if (toIdx === -1) toIdx = stops.length - 1;
  }

  if (fromIdx >= toIdx) {
    return '';
  }

  const intermediateStops = stops.slice(fromIdx + 1, toIdx);

  const viaMatch = rawRouteName?.match(/\(via\s+([^)]+)\)/i);
  if (viaMatch && viaMatch[1]) {
    const viaTarget = viaMatch[1].trim();
    const viaTargetCore = getCoreStopWord(viaTarget);

    const isActuallyInSegment = intermediateStops.some(s => {
      const sCore = getCoreStopWord(s.name);
      return sCore.includes(viaTargetCore) || viaTargetCore.includes(sCore);
    });

    if (isActuallyInSegment) {
      return viaTarget;
    }
  }

  const keyStops = ['Nakur', 'Ambehta', 'Khera Afghan', 'Phandpuri', 'Chilkana', 'Sarsawa', 'Nanauta', 'Rampur Maniharan'];
  for (const key of keyStops) {
    const keyCore = getCoreStopWord(key);
    const foundStop = intermediateStops.find(s => {
      const sCore = getCoreStopWord(s.name);
      return sCore.includes(keyCore) || keyCore.includes(sCore);
    });
    if (foundStop) {
      return key;
    }
  }

  return '';
}

function getDeduplicatedRoutes(routes: Route[], fromStop: string, toStop: string): { route: Route; viaText: string }[] {
  if (!routes || routes.length === 0) return [];

  const grouped = new Map<string, { route: Route; viaText: string }>();

  for (const r of routes) {
    const viaText = getSegmentViaText(r.stops || [], fromStop, toStop, r.route_name);
    const key = `${getCoreStopWord(fromStop)}_${getCoreStopWord(toStop)}_${viaText.toLowerCase()}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        route: {
          ...r,
          nextTrips: [...(r.nextTrips || [])],
          missedTrips: [...(r.missedTrips || [])]
        },
        viaText
      });
    } else {
      const existing = grouped.get(key)!;
      const existingNextIds = new Set(existing.route.nextTrips.map(t => t.tripId));
      for (const trip of (r.nextTrips || [])) {
        if (!existingNextIds.has(trip.tripId)) {
          existing.route.nextTrips.push(trip);
        }
      }
      const existingMissedIds = new Set(existing.route.missedTrips.map(t => t.tripId));
      for (const trip of (r.missedTrips || [])) {
        if (!existingMissedIds.has(trip.tripId)) {
          existing.route.missedTrips.push(trip);
        }
      }
    }
  }

  return Array.from(grouped.values());
}

function getDeduplicatedJourneys(journeys: Journey[], fromStop: string, toStop: string): Journey[] {
  if (!journeys || journeys.length === 0) return [];

  const seenKeys = new Set<string>();
  const deduplicated: Journey[] = [];

  for (const j of journeys) {
    if (j.totalTransfers === 0 && j.legs && j.legs.length > 0) {
      const stops = j.legs[0].stops || [];
      const viaText = getSegmentViaText(stops, fromStop, toStop, j.legs[0].routeName);
      const key = `${getCoreStopWord(fromStop)}_${getCoreStopWord(toStop)}_${viaText.toLowerCase()}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      deduplicated.push(j);
    } else {
      deduplicated.push(j);
    }
  }

  return deduplicated;
}

const getDistinguishingStop = (journey: Journey, allJourneys: Journey[], fromCity: string, toCity: string) => {
  if (allJourneys.length <= 1 || journey.totalTransfers > 0 || !journey.legs || journey.legs.length === 0) {
    return 'Direct';
  }

  const currentStops = journey.legs[0].stops || [];
  if (currentStops.length === 0) return 'Direct';

  const viaText = getSegmentViaText(currentStops, fromCity, toCity, journey.legs[0].routeName);
  if (viaText) {
    return viaText;
  }

  return 'Direct';
};

let API_BASE = '/api/v1';
let WS_BASE = 'ws://51.20.190.81:5000';
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  WS_BASE = 'ws://localhost:5000';
}

// ─── Journey Timeline Component ───────────────────────────────────────────────
function JourneyTimeline({ journey, onTrackBus }: { journey: Journey; onTrackBus: (tripId: number, regNo: string, routeCode?: string) => void }) {
  const [expandedLegs, setExpandedLegs] = useState<Set<number>>(new Set());
  const baseTime = new Date();

  const toggleLeg = (idx: number) => {
    setExpandedLegs(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  // Build flat stop list with leg transitions
  const allNodes: { type: 'depot'; name: string; state: string; offsetMins: number; isTransfer: boolean; legIdx?: number }[] = [];

  journey.legs.forEach((leg, i) => {
    if (i === 0) {
      allNodes.push({ type: 'depot', name: leg.stops[0]?.name || leg.from, state: 'Uttar Pradesh', offsetMins: leg.departureOffsetMins, isTransfer: false });
    }
    allNodes.push({ type: 'depot', name: leg.stops[leg.stops.length - 1]?.name || leg.to, state: 'Uttar Pradesh', offsetMins: leg.arrivalOffsetMins, isTransfer: i < journey.legs.length - 1, legIdx: i });
  });

  return (
    <div className="journey-card">
      {/* Header */}
      <div className="journey-header">
        <div className="journey-route-title">
          <span className="journey-from">{journey.from}</span>
          <ArrowRight size={16} className="journey-arrow" />
          <span className="journey-to">{journey.to}</span>
        </div>
        <div className="journey-meta">
          <span className="journey-meta-item">🚌 {journey.totalLegs} bus{journey.totalLegs > 1 ? ' changes' : ''}</span>
          <span className="journey-meta-sep">•</span>
          <span className="journey-meta-item">📍 ~{journey.totalDistanceKm} km</span>
          <span className="journey-meta-sep">•</span>
          <span className="journey-meta-item">⏱ ~{fmtDuration(journey.totalDurationMins)}</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="journey-timeline">
        {journey.legs.map((leg, legIdx) => {
          const isExpanded = expandedLegs.has(legIdx);
          const departureStop = leg.stops[0];
          const arrivalStop = leg.stops[leg.stops.length - 1];
          const midStops = leg.stops.slice(1, -1);

          return (
            <div key={legIdx} className="journey-leg">
              {/* Departure node */}
              <div className="timeline-node departure-node">
                <div className="node-dot filled" />
                <div className="node-info">
                  <div className="node-name">{departureStop?.name || leg.fromCity}</div>
                  <div className="node-state">Uttar Pradesh</div>
                </div>
                <div className="node-time">
                  <div className="time-offset">{legIdx === 0 ? 'Departure' : '+' + fmtDuration(leg.departureOffsetMins)}</div>
                  <div className="time-clock">{fmtTime(baseTime, leg.departureOffsetMins)}</div>
                </div>
              </div>

              {/* Bus connector */}
              <div className="timeline-connector">
                <div className="connector-line" />
                <div className="connector-card">
                  <div className="connector-bus-info">
                    <Bus size={14} />
                    <span className="connector-bus-type">{leg.busInfo?.bus_type || 'Ordinary'}</span>
                    {leg.busInfo && (
                      <span className="connector-reg">{leg.busInfo.registration_no}</span>
                    )}
                    {leg.busInfo && leg.busInfo.current_speed_kmph !== undefined && (
                      <span className="live-speed-tag">
                        ⚡ Live: {leg.busInfo.current_speed_kmph > 0 ? `${Math.round(leg.busInfo.current_speed_kmph)} km/h` : 'Halted'}
                      </span>
                    )}
                  </div>
                  <div className="connector-stats">
                    <span>{fmtDuration(leg.durationMins)}</span>
                    <span className="connector-dot">•</span>
                    <span>{leg.distanceKm} km</span>
                  </div>
                  {leg.busInfo && (
                    <button
                      className="track-btn-small"
                      onClick={() => onTrackBus(leg.busInfo!.trip_id, leg.busInfo!.registration_no, leg.routeCode)}
                    >
                      <Navigation size={11} /> Track Live
                    </button>
                  )}
                  {/* Intermediate stops toggle */}
                  {midStops.length > 0 && (
                    <button className="stops-toggle" onClick={() => toggleLeg(legIdx)}>
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {isExpanded ? 'Hide' : 'Show'} {midStops.length} stop{midStops.length > 1 ? 's' : ''}
                    </button>
                  )}
                  {/* Expanded intermediate stops */}
                  {isExpanded && (
                    <div className="intermediate-stops">
                      {midStops.map((stop, si) => {
                        const stopOffsetMins = leg.departureOffsetMins + Math.round(((si + 1) / (leg.stops.length - 1)) * leg.durationMins);
                        return (
                          <div key={si} className="intermediate-stop">
                            <div className="int-stop-dot" />
                            <div className="int-stop-name">{stop.name}</div>
                            <div className="int-stop-time">{fmtTime(baseTime, stopOffsetMins)}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="connector-line" />
              </div>

              {/* Arrival node (only for last leg) */}
              {legIdx === journey.legs.length - 1 && (
                <div className="timeline-node arrival-node">
                  <div className="node-dot arrival" />
                  <div className="node-info">
                    <div className="node-name">{arrivalStop?.name || leg.toCity}</div>
                    <div className="node-state">Uttar Pradesh</div>
                  </div>
                  <div className="node-time">
                    <div className="time-offset">+{fmtDuration(leg.arrivalOffsetMins)}</div>
                    <div className="time-clock arrival-time">{fmtTime(baseTime, leg.arrivalOffsetMins)}</div>
                  </div>
                </div>
              )}

              {/* Transfer node (for middle legs) */}
              {legIdx < journey.legs.length - 1 && (
                <div className="timeline-node transfer-node-container" style={{ width: '100%' }}>
                  <div className="timeline-node transfer-node" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                    <div className="node-dot transfer" />
                    <div className="node-info">
                      <div className="node-name">{arrivalStop?.name || leg.toCity}</div>
                      <div className="node-state transfer-badge">🔄 Bus Change</div>
                    </div>
                    <div className="node-time">
                      <div className="time-offset">+{fmtDuration(leg.arrivalOffsetMins)}</div>
                      <div className="time-clock">{fmtTime(baseTime, leg.arrivalOffsetMins)}</div>
                    </div>
                  </div>
                  <div className="transfer-details-card">
                    <div className="transfer-card-header">
                      <ArrowLeftRight size={13} className="transfer-card-icon" />
                      <span>Transfer Point (15 mins layover buffer)</span>
                    </div>
                    <div className="transfer-card-body">
                      Change from <strong className="transfer-highlight">{leg.routeName}</strong> to <strong className="transfer-highlight">{journey.legs[legIdx + 1].routeName}</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer summary */}
      <div className="journey-footer">
        <div className="journey-footer-item">
          <Clock size={14} />
          <span>Total Travel Time: ~{fmtDuration(journey.totalDurationMins)}</span>
        </div>
        <div className="journey-footer-item">
          <MapPin size={14} />
          <span>Total Distance: ~{journey.totalDistanceKm} km</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [allStops, setAllStops] = useState<{ id: number; name: string }[]>([]);
  const [showFromSuggestions, setShowFromSuggestions] = useState(false);
  const [showToSuggestions, setShowToSuggestions] = useState(false);
  const [fromSuggestions, setFromSuggestions] = useState<{ id: number; name: string }[]>([]);
  const [toSuggestions, setToSuggestions] = useState<{ id: number; name: string }[]>([]);

  const filterAndDeduplicateStops = (stops: { id: number; name: string }[], queryVal: string) => {
    const q = queryVal.toLowerCase().trim();
    if (!q) return [];

    const matches = stops.filter(s => s.name.toLowerCase().includes(q));

    const isRawAllCaps = (str: string) => {
      const letters = str.replace(/[^a-zA-Z]/g, '');
      return letters.length > 0 && letters === letters.toUpperCase();
    };

    const sortedCandidates = [...matches].sort((a, b) => {
      const aAllCaps = isRawAllCaps(a.name);
      const bAllCaps = isRawAllCaps(b.name);

      if (aAllCaps && !bAllCaps) return 1;
      if (!aAllCaps && bAllCaps) return -1;

      const terminalRegex = /(Bus Station|Bus Stand|Terminal|ISBT|Depot)/i;
      const aIsTerminal = terminalRegex.test(a.name);
      const bIsTerminal = terminalRegex.test(b.name);

      if (aIsTerminal && !bIsTerminal) return -1;
      if (!aIsTerminal && bIsTerminal) return 1;

      return a.name.localeCompare(b.name);
    });

    const result: { id: number; name: string }[] = [];
    const seenNames = new Set<string>();

    for (const stop of sortedCandidates) {
      const lowerName = stop.name.toLowerCase().trim();

      if (isRawAllCaps(stop.name)) {
        const hasFormattedEquivalent = result.some(r => r.name.toLowerCase().includes(lowerName));
        if (hasFormattedEquivalent) continue;
      }

      if (seenNames.has(lowerName)) continue;

      seenNames.add(lowerName);
      result.push(stop);
    }

    return result.slice(0, 8);
  };

  const handleFromChange = (val: string) => {
    setFrom(val);
    if (!val.trim()) {
      setFromSuggestions([]);
      return;
    }
    const filtered = filterAndDeduplicateStops(allStops, val);
    setFromSuggestions(filtered);
    setShowFromSuggestions(true);
  };

  const handleToChange = (val: string) => {
    setTo(val);
    if (!val.trim()) {
      setToSuggestions([]);
      return;
    }
    const filtered = filterAndDeduplicateStops(allStops, val);
    setToSuggestions(filtered);
    setShowToSuggestions(true);
  };

  const selectFromSuggestion = (name: string) => {
    setFrom(name);
    setShowFromSuggestions(false);
  };

  const selectToSuggestion = (name: string) => {
    setTo(name);
    setShowToSuggestions(false);
  };

  const [loading, setLoading] = useState(false);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [selectedJourneyIdx, setSelectedJourneyIdx] = useState(0);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [viewMode, setViewMode] = useState<'direct' | 'journey' | 'bus'>('bus');
  const [busNumber, setBusNumber] = useState('UP11AT0072');

  const [selectedTrip, setSelectedTrip] = useState<ActiveTrip | null>(null);
  const [liveDetails, setLiveDetails] = useState<TripLiveDetails | null>(null);

  // Push Notification States
  const [notified5Min, setNotified5Min] = useState(false);
  const [notified10Min, setNotified10Min] = useState(false);

  // Request Notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }, []);

  // Monitor ETA for Push Notifications
  useEffect(() => {
    if (!liveDetails || !liveDetails.stops || liveDetails.stops.length === 0) return;
    
    const upcomingStop = liveDetails.stops.find(s => s.status === 'upcoming' || s.status === 'arriving_soon' || s.status === 'arriving_now');
    if (!upcomingStop || upcomingStop.etaMinutes === undefined) return;

    const eta = upcomingStop.etaMinutes;

    if (eta <= 10 && eta > 5 && !notified10Min) {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('UPBus Alert 🚍', {
          body: `Your bus ${liveDetails.busRegNo} is arriving at ${upcomingStop.name} in ~${eta} mins!`,
          icon: '/favicon.ico'
        });
      }
      setNotified10Min(true);
    } else if (eta <= 5 && !notified5Min) {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('UPBus Alert 🚍', {
          body: `Get ready! Bus ${liveDetails.busRegNo} is arriving at ${upcomingStop.name} in ~${eta} mins!`,
          icon: '/favicon.ico'
        });
      }
      setNotified5Min(true);
    }
    
    // Reset if a new trip is tracked or ETA increases significantly
    if (eta > 12) {
      setNotified10Min(false);
      setNotified5Min(false);
    }
  }, [liveDetails, notified5Min, notified10Min]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [isWebSocket, setIsWebSocket] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [mobileTab, setMobileTab] = useState<'search' | 'map'>('search');
  const [isPassenger, setIsPassenger] = useState(false);
  const [demoPassenger, setDemoPassenger] = useState(false);
  const [showAdvancedPassengerSettings, setShowAdvancedPassengerSettings] = useState(false);
  const [trackingSource, setTrackingSource] = useState<'gps' | 'network' | 'cell'>('gps');
  const [passengerDistanceNotice, setPassengerDistanceNotice] = useState<string | null>(null);
  
  const reportIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const demoStateRef = useRef<{ currentIndex: number; step: number }>({ currentIndex: 0, step: 0 });

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [villages, setVillages] = useState<Village[]>([]);

  const [passengerReports, setPassengerReports] = useState<any[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportType, setReportType] = useState('Delay');
  const [reportDesc, setReportDesc] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);

  // Mount logic: Service worker registration & active report fetching
  useEffect(() => {
    const fetchStops = async () => {
      try {
        const res = await fetch(`${API_BASE}/stops`);
        if (res.ok) {
          const data = await res.json();
          setAllStops(data.stops || []);
        }
      } catch (e) {
        console.warn('Failed to fetch stops list:', e);
      }
    };
    fetchStops();

    // Register Service Worker and check subscription
    import('./utils/swHelper').then(async (m) => {
      await m.registerServiceWorker();
      const sub = await m.getPushSubscription();
      setIsSubscribed(!!sub);
    }).catch(err => console.warn('Failed to load swHelper:', err));

    // Fetch reports
    // eslint-disable-next-line react-hooks/immutability
    fetchActiveReports();

    // Poll reports every 10 seconds
    const interval = setInterval(fetchActiveReports, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchActiveReports = async () => {
    try {
      const res = await fetch(`${API_BASE}/reports/active`);
      if (res.ok) {
        const data = await res.json();
        setPassengerReports(data.reports || []);
      }
    } catch (e) {
      console.warn('Failed to fetch active passenger reports:', e);
    }
  };

  const handleNotificationToggle = async () => {
    try {
      const swHelper = await import('./utils/swHelper');
      if (isSubscribed) {
        const success = await swHelper.unsubscribeFromNotifications(API_BASE);
        if (success) {
          setIsSubscribed(false);
          alert('Notifications disabled.');
        }
      } else {
        const sub = await swHelper.subscribeToNotifications(API_BASE);
        if (sub) {
          setIsSubscribed(true);
          alert('Notifications enabled! You will receive arrivals alerts.');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Notification configuration failed.';
      alert(message);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTrip || !liveDetails) return;
    setSubmittingReport(true);
    try {
      const lat = liveDetails.busLatitude || (liveDetails.stops?.[0]?.latitude) || null;
      const lng = liveDetails.busLongitude || (liveDetails.stops?.[0]?.longitude) || null;

      const response = await fetch(`${API_BASE}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tripId: selectedTrip.trip_id,
          busRegNo: selectedTrip.registration_no || liveDetails.busRegNo,
          reportType,
          description: reportDesc,
          latitude: lat,
          longitude: lng
        })
      });

      if (response.ok) {
        alert('Report submitted successfully! Thank you.');
        setShowReportModal(false);
        setReportDesc('');
        fetchActiveReports(); // Refresh reports
      } else {
        alert('Failed to submit report. Please try again.');
      }
    } catch (error) {
      console.error('Error submitting report:', error);
      alert('Error submitting report.');
    } finally {
      setSubmittingReport(false);
    }
  };


  const fetchLiveDetailsManual = async () => {
    if (!selectedTrip) return;
    setIsRefreshing(true);
    try {
      const regNoParam = selectedTrip.registration_no ? `?regNo=${selectedTrip.registration_no}` : '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const routeCodeParam = (selectedTrip as any).routeCode ? (regNoParam ? `&routeCode=${(selectedTrip as any).routeCode}` : `?routeCode=${(selectedTrip as any).routeCode}`) : '';
      const res = await fetch(`${API_BASE}/trips/${selectedTrip.trip_id}/live${regNoParam}${routeCodeParam}`);
      const data = await res.json();
      setLiveDetails(data);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to refresh', err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // ── Search handler ───────────────────────────────────────────────────────
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!from.trim() || !to.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setJourneys([]);
    setSelectedJourneyIdx(0);
    setRoutes([]);
    setSelectedRouteIdx(0);
    setSelectedTrip(null);
    setLiveDetails(null);
    setVillages([]);

    try {
      if (viewMode === 'journey') {
        const [jRes, rRes] = await Promise.all([
          fetch(`${API_BASE}/journey?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
          fetch(`${API_BASE}/search/routes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
        ]);
        const data = await jRes.json();
        const d2 = await rRes.json();

        const journeysList = data.journeys || (data.legs ? [data] : []);
        setJourneys(journeysList);
        setSelectedJourneyIdx(0);
        const directRoutesList = d2.routes || [];
        setRoutes(directRoutesList);

        // If journey planner returns no multi-leg journeys but direct routes exist,
        // automatically switch view to 'direct' so map immediately renders direct routes and active buses!
        if (journeysList.length === 0 && directRoutesList.length > 0) {
          setViewMode('direct');
        }

        const firstLeg = journeysList[0]?.legs?.[0];
        const routeIdToFetch = firstLeg?.routeId
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          || (d2.routes || []).find((r: any) => r.route_code === firstLeg?.routeCode)?.id;
        if (routeIdToFetch) {
          try {
            const vRes = await fetch(`${API_BASE}/routes/${routeIdToFetch}/villages`);
            const vData = await vRes.json();
            setVillages(vData.villages || []);
          } catch { setVillages([]); }
        }

      } else {
        const res = await fetch(`${API_BASE}/search/routes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        const data = await res.json();
        const fetchedRoutes = data.routes || [];
        setRoutes(fetchedRoutes);
        // Fetch villages for the first (selected) route
        if (fetchedRoutes.length > 0) {
          try {
            const vRes = await fetch(`${API_BASE}/routes/${fetchedRoutes[0].id}/villages`);
            const vData = await vRes.json();
            setVillages(vData.villages || []);
          } catch { setVillages([]); }
        }
      }
      setHasSearched(true);
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setLoading(false);
    }
  };

  const swapCities = () => { setFrom(to); setTo(from); };

  const handleSearchBus = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!busNumber.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setJourneys([]);
    setSelectedJourneyIdx(0);
    setRoutes([]);
    try {
      const res = await fetch(`${API_BASE}/search/bus/${busNumber}`);
      if (!res.ok) {
        if (res.status === 404) alert('Bus not found or offline');
        return;
      }
      const data = await res.json();
      setSelectedTrip({ trip_id: data.tripId, status: data.status, registration_no: data.busRegNo, bus_type: data.busType, depot_name: 'Margdarshi Live' });
      setLiveDetails(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // ── Track Bus ────────────────────────────────────────────────────────────
  const handleTrackBus = async (tripId: number, regNo: string, routeCode?: string) => {
    try {
      setSelectedTrip({ trip_id: tripId, registration_no: regNo, status: '', bus_type: '', depot_name: '', routeCode });
      setTrackingLoading(true);
      const regNoParam = regNo ? `?regNo=${regNo}` : '';
      const routeCodeParam = routeCode ? (regNoParam ? `&routeCode=${routeCode}` : `?routeCode=${routeCode}`) : '';
      const res = await fetch(`${API_BASE}/trips/${tripId}/live${regNoParam}${routeCodeParam}`);
      const data = await res.json();
      setLiveDetails(data);
      setLastUpdated(new Date());
      setTrackingLoading(false);
      // Fetch villages for the tracked route
      const routeIdToFetch = data.routeId
        || routes.find(r => r.route_code === routeCode)?.id
        || (routes.length > 0 ? routes[0].id : null);
      if (routeIdToFetch) {
        console.log(`[Villages] Fetching for route ${routeIdToFetch}`);
        try {
          const vRes = await fetch(`${API_BASE}/routes/${routeIdToFetch}/villages`);
          const vData = await vRes.json();
          console.log(`[Villages] Got ${(vData.villages || []).length} villages`);
          setVillages(vData.villages || []);
        } catch (e) {
          console.warn('[Villages] Fetch failed:', e);
        }
      }
    } catch (err) {
      console.error(err);
      setTrackingLoading(false);
      return;
    }

    // Clean up previous
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }

    setMobileTab('map');

    const fetchData = async () => {
      const regNoParam = regNo ? `?regNo=${regNo}` : '';
      const routeCodeParam = routeCode ? (regNoParam ? `&routeCode=${routeCode}` : `?routeCode=${routeCode}`) : '';
      const res = await fetch(`${API_BASE}/trips/${tripId}/live${regNoParam}${routeCodeParam}`);
      const data = await res.json();
      setLiveDetails(data);
      setLastUpdated(new Date());
    };

    // Try WebSocket first
    try {
      const ws = new WebSocket(WS_BASE);
      ws.onopen = () => {
        ws.send(JSON.stringify({ event: 'subscribe_trip', tripId, regNo, routeCode }));
        setIsWebSocket(true);
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'trip_update') { setLiveDetails(msg.data); setLastUpdated(new Date()); setTrackingLoading(false); }
      };
      ws.onerror = () => {
        setIsWebSocket(false);
        fetchData();
        pollingIntervalRef.current = setInterval(fetchData, 6000);
      };
      wsRef.current = ws;
    } catch {
      setIsWebSocket(false);
      fetchData();
      pollingIntervalRef.current = setInterval(fetchData, 6000);
    }
  };

  const stopTracking = () => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
    if (reportIntervalRef.current) { clearInterval(reportIntervalRef.current); reportIntervalRef.current = null; }
    setSelectedTrip(null); setLiveDetails(null); setIsWebSocket(false);
    setIsPassenger(false);
  };

  const displayRoutes = getDeduplicatedRoutes(routes, from, to);
  const displayJourneys = getDeduplicatedJourneys(journeys, from, to);
  const journey = displayJourneys[selectedJourneyIdx] || null;

  // Auto-track bus when selecting a route in Bus Mode
  useEffect(() => {
    if (viewMode === 'bus' && displayRoutes.length > 0 && displayRoutes[selectedRouteIdx]) {
      const r = displayRoutes[selectedRouteIdx].route;
      
      const trip = r.nextTrips?.[0] || r.missedTrips?.[0];
      if (trip && !isPassenger) {
        handleTrackBus(trip.tripId, trip.busRegNo, trip.routeCode);
      } else {
        stopTracking();
      }
    }
  }, [selectedRouteIdx, displayRoutes, viewMode, isPassenger]);

  // Auto-track bus when selecting a journey option
  useEffect(() => {
    if (viewMode === 'journey' && displayJourneys.length > 0 && displayJourneys[selectedJourneyIdx]) {
      const journey = displayJourneys[selectedJourneyIdx];
      const firstLeg = journey.legs[0];
      if (firstLeg && firstLeg.busInfo && !isPassenger) {
        handleTrackBus(firstLeg.busInfo.trip_id, firstLeg.busInfo.registration_no, firstLeg.routeCode);
      } else {
        stopTracking();
      }
    }
  }, [selectedJourneyIdx, displayJourneys, viewMode, isPassenger]);

  // ── Crowd-sourced location reporting effect ──────────────────────────────
  useEffect(() => {
    if (reportIntervalRef.current) {
      clearInterval(reportIntervalRef.current);
      reportIntervalRef.current = null;
    }

    if (!selectedTrip || !isPassenger) return;

    demoStateRef.current = { currentIndex: 0, step: 0 };

    const reportLocation = () => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      if (demoPassenger) {
        if (!liveDetails || !liveDetails.stops || liveDetails.stops.length === 0) return;
        const stops = liveDetails.stops;
        const state = demoStateRef.current;

        if (state.currentIndex >= stops.length - 1) {
          state.currentIndex = 0;
          state.step = 0;
        }

        const currentStop = stops[state.currentIndex];
        const nextStop = stops[state.currentIndex + 1];

        const fraction = state.step / 10;
        let lat = currentStop.latitude + (nextStop.latitude - currentStop.latitude) * fraction;
        let lng = currentStop.longitude + (nextStop.longitude - currentStop.longitude) * fraction;

        if (trackingSource === 'cell' || trackingSource === 'network') {
          lat += 0.0012 * (Math.random() - 0.5);
          lng += 0.0012 * (Math.random() - 0.5);
        }

        wsRef.current.send(JSON.stringify({
          event: 'report_location',
          tripId: selectedTrip.trip_id,
          latitude: lat,
          longitude: lng,
          speed: trackingSource === 'cell' ? 0 : Math.floor(40 + Math.random() * 20),
          heading: 90,
          source: trackingSource
        }));

        state.step += 1;
        if (state.step > 10) {
          state.step = 0;
          state.currentIndex += 1;
        }
      } else {
        if (typeof window === 'undefined' || !navigator.geolocation) {
          console.warn('Geolocation not supported');
          return;
        }

        navigator.geolocation.getCurrentPosition(
          (pos) => {
            let lat = pos.coords.latitude;
            let lng = pos.coords.longitude;
            let speed = pos.coords.speed || 0;
            // eslint-disable-next-line prefer-const
            let heading = pos.coords.heading || 0;

            if (trackingSource === 'cell' || trackingSource === 'network') {
              lat += 0.0012 * (Math.random() - 0.5);
              lng += 0.0012 * (Math.random() - 0.5);
              speed = 0;
            }

            // Check distance to route corridor to give smart friendly notice if passenger is away
            if (liveDetails && liveDetails.stops && liveDetails.stops.length > 0) {
              let minDist = Infinity;
              liveDetails.stops.forEach(s => {
                if (s.latitude && s.longitude) {
                  const d = calculateDistance(lat, lng, s.latitude, s.longitude);
                  if (d < minDist) minDist = d;
                }
              });
              if (minDist > 15) {
                setPassengerDistanceNotice(`You are ~${Math.round(minDist)} km away from this bus route.`);
              } else {
                setPassengerDistanceNotice(null);
              }
            }

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                event: 'report_location',
                tripId: selectedTrip.trip_id,
                latitude: lat,
                longitude: lng,
                speed: Math.round(speed * 3.6),
                heading,
                source: trackingSource
              }));
            }
          },
          (err) => {
            console.error('Geolocation error:', err);
            setTrackingSource('network');
          },
          { enableHighAccuracy: trackingSource === 'gps', timeout: 5000, maximumAge: 0 }
        );
      }
    };

    reportLocation();
    reportIntervalRef.current = setInterval(reportLocation, 5000);

    return () => {
      if (reportIntervalRef.current) {
        clearInterval(reportIntervalRef.current);
        reportIntervalRef.current = null;
      }
    };
  }, [selectedTrip, isPassenger, demoPassenger, trackingSource, liveDetails]);

  useEffect(() => () => {
    if (wsRef.current) wsRef.current.close();
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (reportIntervalRef.current) clearInterval(reportIntervalRef.current);
  }, []);

  // ── Helper: clip a stop list to only the from→to segment ──────────────────
  // Passenger only cares about stops between their origin and destination,
  // not the full bus route (e.g. Saharanpur→Gangoh for a Phandpuri→Ambehta trip)
  function clipStopsToSegment(stops: any[], fromQuery: string, toQuery: string) {
    if (!fromQuery || !toQuery || stops.length === 0) return stops;
    const fq = fromQuery.toLowerCase().trim();
    const tq = toQuery.toLowerCase().trim();
    let fromIdx = stops.findIndex(s => s.name?.toLowerCase().includes(fq));
    let toIdx = stops.findIndex(s => s.name?.toLowerCase().includes(tq));
    if (fromIdx === -1 || toIdx === -1) return stops;   // fallback: show all
    if (fromIdx > toIdx) [fromIdx, toIdx] = [toIdx, fromIdx]; // handle reversed
    return stops.slice(fromIdx, toIdx + 1);
  }

  // Helper variables for LiveMap in non-tracking modes
  let mapBusLat = 29.964;
  let mapBusLng = 77.546;
  let mapBusRegNo = '';
  let mapBusHeading = 0;
  let mapBusSpeed = 0;
  let mapBusRouteName = '';

  if (viewMode === 'journey' && displayJourneys.length > 0) {
    const selectedJourney = displayJourneys[selectedJourneyIdx];
    if (selectedJourney) {
      // Set map center to start stop of first leg
      const firstStop = selectedJourney.legs?.[0]?.stops?.[0];
      if (firstStop) {
        mapBusLat = firstStop.latitude;
        mapBusLng = firstStop.longitude;
      }
      // Check for active bus on any leg of this journey
      const activeLeg = selectedJourney.legs?.find(
        l => l.busInfo && typeof l.busInfo.bus_latitude === 'number' && typeof l.busInfo.bus_longitude === 'number'
      );
      if (activeLeg && activeLeg.busInfo && typeof activeLeg.busInfo.bus_latitude === 'number' && typeof activeLeg.busInfo.bus_longitude === 'number') {
        mapBusLat = activeLeg.busInfo.bus_latitude;
        mapBusLng = activeLeg.busInfo.bus_longitude;
        mapBusRegNo = activeLeg.busInfo.registration_no;
        mapBusHeading = activeLeg.busInfo.heading || 0;
        mapBusSpeed = activeLeg.busInfo.current_speed_kmph || 0;
        mapBusRouteName = activeLeg.routeName;
      }
    }
  } else if (viewMode === 'direct' && displayRoutes.length > 0) {
    const selectedRoute = displayRoutes[selectedRouteIdx]?.route;
    if (selectedRoute) {
      const firstStop = selectedRoute.stops?.[0];
      if (firstStop) {
        mapBusLat = firstStop.latitude;
        mapBusLng = firstStop.longitude;
      }
      // Check for active bus on nextTrips
      const activeTrip = selectedRoute.nextTrips?.find(
        t => typeof t.busLatitude === 'number' && typeof t.busLongitude === 'number'
      );
      if (activeTrip && typeof activeTrip.busLatitude === 'number' && typeof activeTrip.busLongitude === 'number') {
        mapBusLat = activeTrip.busLatitude;
        mapBusLng = activeTrip.busLongitude;
        mapBusRegNo = activeTrip.busRegNo;
        mapBusHeading = activeTrip.heading || 0;
        mapBusSpeed = activeTrip.currentSpeedKmph || 0;
        mapBusRouteName = activeTrip.routeName;
      }
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const hasDirectRoutes = displayRoutes.length > 0;
  const hasJourney = displayJourneys.length > 0 && journey && journey.legs && journey.legs.length > 0;
  const showTrackingPanel = liveDetails !== null;

  // Filtered stops for active tracking bus
  const fromQuery = (from || '').toLowerCase().trim();
  const toQuery = (to || '').toLowerCase().trim();

  let filteredStops: StopETA[] = [];
  if (liveDetails && liveDetails.stops) {
    let startIdx = 0;
    if (fromQuery) {
      const idx = liveDetails.stops.findIndex(s => s.name.toLowerCase().includes(fromQuery));
      if (idx !== -1) startIdx = idx;
    }
    let endIdx = liveDetails.stops.length - 1;
    if (toQuery) {
      const idx = liveDetails.stops.findIndex(s => s.name.toLowerCase().includes(toQuery));
      if (idx !== -1) endIdx = idx;
    }
    let sIdx = startIdx;
    let eIdx = endIdx;
    if (sIdx > eIdx) {
      [sIdx, eIdx] = [eIdx, sIdx];
    }
    filteredStops = liveDetails.stops.slice(sIdx, eIdx + 1);
  }

  return (
    <main className="app-root">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="header-inner">
          <div className="logo-group">
            <div className="logo-icon"><Bus size={22} /></div>
            <div>
              <div className="logo-title">UP BUS LIVE</div>
              <div className="logo-sub">Uttar Pradesh SRTC Tracker</div>
            </div>
          </div>
          <div className="header-badge">
            <Zap size={12} /> LIVE GPS
          </div>
        </div>
      </header>

      <div className="page-body">
        {/* Mobile View Switcher Tab Bar */}
        <div className="mobile-nav-bar">
          <button 
            type="button" 
            className={`mobile-nav-btn ${mobileTab === 'search' ? 'active' : ''}`}
            onClick={() => setMobileTab('search')}
          >
            <Search size={16} />
            <span>Search & Trips</span>
          </button>
          <button 
            type="button" 
            className={`mobile-nav-btn ${mobileTab === 'map' ? 'active' : ''}`}
            onClick={() => setMobileTab('map')}
          >
            <Navigation size={16} />
            <span>Live Map</span>
            {showTrackingPanel && <span className="mobile-live-dot" />}
          </button>
        </div>

        {/* ── Search Panel (Left Sidebar) ── */}
        <aside className={`search-panel ${mobileTab === 'search' ? 'mobile-panel-active' : 'mobile-panel-hidden'}`}>
          {!showTrackingPanel ? (
            <form onSubmit={viewMode === 'bus' ? handleSearchBus : handleSearch} className="search-form">
              <div className="search-title">Find Your Bus</div>

              {/* Mode toggle */}
              <div className="mode-toggle">
                <button type="button" className={`mode-btn ${viewMode === 'bus' ? 'active' : ''}`} onClick={() => { setViewMode('bus'); setJourneys([]); setRoutes([]); stopTracking(); }}>
                  <Bus size={13} /> Bus No.
                </button>
                <button type="button" className={`mode-btn ${viewMode === 'journey' ? 'active' : ''}`} onClick={() => setViewMode('journey')}>
                  <Train size={13} /> Journey Plan
                </button>
                <button type="button" className={`mode-btn ${viewMode === 'direct' ? 'active' : ''}`} onClick={() => setViewMode('direct')}>
                  <Navigation size={13} /> Direct Routes
                </button>
              </div>

              {viewMode === 'bus' ? (
                <div className="input-group">
                  <div className="input-wrapper" style={{ flex: 1 }}>
                    <Bus size={16} className="input-icon from-icon" />
                    <input
                      type="text"
                      placeholder="Enter Bus No. (e.g., UP11AT0072)"
                      value={busNumber}
                      onChange={(e) => setBusNumber(e.target.value.toUpperCase())}
                      className="search-input"
                      autoComplete="off"
                      required
                    />
                  </div>
                </div>
              ) : (
                <div className="input-group">
                  <div className="input-wrapper" style={{ position: 'relative' }}>
                    <MapPin size={16} className="input-icon from-icon" />
                    <input
                      id="from-input"
                      type="text"
                      value={from}
                      onChange={e => handleFromChange(e.target.value)}
                      onBlur={() => setTimeout(() => setShowFromSuggestions(false), 250)}
                      onFocus={() => { if (from.trim()) setShowFromSuggestions(true); }}
                      placeholder="From (e.g. Saharanpur)"
                      className="search-input"
                      autoComplete="off"
                    />
                    {showFromSuggestions && fromSuggestions.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {fromSuggestions.map(s => (
                          <div
                            key={s.id}
                            className="autocomplete-item"
                            onClick={() => selectFromSuggestion(s.name)}
                          >
                            <MapPin size={12} className="dropdown-item-icon" />
                            <span>{s.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" className="swap-btn" onClick={swapCities} title="Swap">
                    <ArrowLeftRight size={16} />
                  </button>
                  <div className="input-wrapper" style={{ position: 'relative' }}>
                    <MapPin size={16} className="input-icon to-icon" />
                    <input
                      id="to-input"
                      type="text"
                      value={to}
                      onChange={e => handleToChange(e.target.value)}
                      onBlur={() => setTimeout(() => setShowToSuggestions(false), 250)}
                      onFocus={() => { if (to.trim()) setShowToSuggestions(true); }}
                      placeholder="To (e.g. Mirzapur)"
                      className="search-input"
                      autoComplete="off"
                    />
                    {showToSuggestions && toSuggestions.length > 0 && (
                      <div className="autocomplete-dropdown">
                        {toSuggestions.map(s => (
                          <div
                            key={s.id}
                            className="autocomplete-item"
                            onClick={() => selectToSuggestion(s.name)}
                          >
                            <MapPin size={12} className="dropdown-item-icon" />
                            <span>{s.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <button type="submit" disabled={loading} className="search-btn">
                {loading ? <><RotateCw size={16} className="spin" /> Searching...</> : <><Search size={16} /> {viewMode === 'bus' ? 'Track Bus' : 'Search Routes'}</>}
              </button>
            </form>
          ) : (
            <div style={{ marginBottom: '12px' }}>
              <button 
                type="button"
                onClick={stopTracking} 
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#9ca3af',
                  padding: '9px 14px',
                  borderRadius: '10px',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: '100%',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#f3f4f6'}
                onMouseLeave={e => e.currentTarget.style.color = '#9ca3af'}
              >
                ← Back to Search
              </button>
            </div>
          )}

          {/* ── Active Bus Live Tracking Details (Sidebar) ── */}
          {showTrackingPanel && liveDetails && !liveDetails.error && (
            <div className="sidebar-tracking-details">
              <div className="tracking-header">
                <div className="tracking-title">
                  <Bus size={18} />
                  <div>
                    <div className="tracking-reg">{liveDetails.busRegNo}</div>
                    <div className="tracking-route">{liveDetails.routeName}</div>
                  </div>
                </div>
                <div className="tracking-right">
                  {lastUpdated && (
                    <div className="last-updated" style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button onClick={fetchLiveDetailsManual} disabled={isRefreshing} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', padding: 0 }}>
                        <RefreshCcw size={14} className={isRefreshing ? 'spin' : ''} />
                      </button>
                    </div>
                  )}
                  <div className={`ws-badge ${isWebSocket ? 'ws-live' : 'ws-poll'}`}>
                    {isWebSocket ? '🟢 WS' : '🔵 POLL'}
                  </div>
                  <button className="close-btn" onClick={stopTracking}>✕</button>
                </div>
              </div>

              {/* Speed + Status */}
              <div className="tracking-stats">
                <div className="stat-pill">
                  <Navigation size={13} />
                  <span>{liveDetails.currentSpeedKmph} km/h</span>
                </div>
                <div className="stat-pill">
                  <div className={`status-dot ${liveDetails.status === 'running' ? 'running' : 'halted'}`} />
                  <span>{liveDetails.status}</span>
                </div>
                <div className="stat-pill">
                  <Clock size={13} />
                  <span>{new Date(liveDetails.lastSeen).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                {(liveDetails as any).trackingMethod && (
                  <div className="stat-pill tracking-source-badge">
                    <Zap size={12} />
                    <span>
                      {(liveDetails as any).trackingMethod === 'gps' ? 'Crowd GPS' : 
                       (liveDetails as any).trackingMethod === 'network' ? 'Network' : 'Cell Tower'}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowReportModal(true)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12px', padding: '8px 10px' }}
                >
                  ⚠️ Report
                </button>
                <button
                  type="button"
                  className={`btn ${isSubscribed ? 'btn-danger' : 'btn-primary'}`}
                  onClick={handleNotificationToggle}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '12px', padding: '8px 10px' }}
                >
                  🔔 {isSubscribed ? 'Disable' : 'Notify Me'}
                </button>
              </div>

              {/* Passenger Toggle */}
              <div className="passenger-toggle-card">
                <div className="passenger-toggle-row">
                  <div className="toggle-left">
                    <div className="toggle-label">Are you inside this bus?</div>
                    <div className="toggle-sublabel">Share phone location for waiting passengers</div>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={isPassenger}
                      onChange={e => setIsPassenger(e.target.checked)}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>

                {isPassenger && (
                  <div className="passenger-settings-panel" style={{ marginTop: '12px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="location-sharing-indicator" style={{ margin: 0 }}>
                        <span className="sharing-dot pulse-green"></span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#10b981' }}>
                          {demoPassenger ? 'Simulating onboard GPS movement' : 'Broadcasting Live Location'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAdvancedPassengerSettings(!showAdvancedPassengerSettings)}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {showAdvancedPassengerSettings ? 'Hide Options' : 'Options'}
                      </button>
                    </div>

                    {passengerDistanceNotice && !demoPassenger && (
                      <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: '6px', fontSize: '11px', color: '#fbbf24' }}>
                        ⚠️ {passengerDistanceNotice} Sharing location only improves tracking when travelling onboard.
                      </div>
                    )}

                    {showAdvancedPassengerSettings && (
                      <div style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
                        <div className="settings-section">
                          <div className="settings-label" style={{ fontSize: '11px', color: '#94a3b8' }}>Tracking Mode:</div>
                          <div className="tracking-options" style={{ marginTop: '4px' }}>
                            <button
                              type="button"
                              className={`track-option-btn ${trackingSource === 'gps' ? 'active' : ''}`}
                              onClick={() => setTrackingSource('gps')}
                            >
                              ⚡ GPS
                            </button>
                            <button
                              type="button"
                              className={`track-option-btn ${trackingSource === 'network' ? 'active' : ''}`}
                              onClick={() => setTrackingSource('network')}
                            >
                              📶 Network
                            </button>
                            <button
                              type="button"
                              className={`track-option-btn ${trackingSource === 'cell' ? 'active' : ''}`}
                              onClick={() => setTrackingSource('cell')}
                            >
                              🗼 Cell
                            </button>
                          </div>
                        </div>

                        <div className="demo-checkbox-row" style={{ marginTop: '8px' }}>
                          <input
                            type="checkbox"
                            id="demo-mode-checkbox"
                            checked={demoPassenger}
                            onChange={e => setDemoPassenger(e.target.checked)}
                          />
                          <label htmlFor="demo-mode-checkbox" className="demo-label" style={{ fontSize: '11px' }}>
                            Demo Passenger Mode (Simulate movement)
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Live Stops Progress Timeline */}
              <div className="stops-timeline">
                <div className="stops-title">🗺 Live Stops & ETAs</div>
                {(() => {
                  const lastPassedIdx = filteredStops.map(s => s.status).lastIndexOf('passed');
                  const nextUpcomingIdx = filteredStops.findIndex(s => s.status === 'upcoming' || s.status === 'arriving_soon');

                  let busAtStopIdx = -1;
                  filteredStops.forEach((s, idx) => {
                    if (s.status === 'arriving_now' || s.status === 'arriving_soon' || s.status === 'on_stop') {
                      busAtStopIdx = idx;
                    }
                  });

                  const busBetweenStopsAfterIdx = (busAtStopIdx === -1 && lastPassedIdx !== -1 && lastPassedIdx < filteredStops.length - 1) ? lastPassedIdx : -1;

                  return filteredStops.map((stop, idx) => {
                    const isLast = idx === filteredStops.length - 1;
                    const isPassed   = stop.status === 'passed';
                    const isOnStop   = stop.status === 'on_stop';
                    const isBusHere  = idx === busAtStopIdx;
                    const isBusAfterThis = idx === busBetweenStopsAfterIdx;

                    const statusClass = isPassed ? 'passed' : isOnStop ? 'on-stop' : isBusHere ? 'arriving' : 'upcoming';

                    let busSegmentProgress = 50;
                    if (isBusAfterThis && idx < filteredStops.length - 1) {
                      const nextStop = filteredStops[idx + 1];
                      if (nextStop && nextStop.distanceRemainingKm !== undefined) {
                        const segDist = calculateDistance(stop.latitude, stop.longitude, nextStop.latitude, nextStop.longitude) || 5;
                        const ratio = Math.max(0.1, Math.min(0.9, 1 - (nextStop.distanceRemainingKm / segDist)));
                        busSegmentProgress = Math.round(ratio * 100);
                      }
                    }

                    return (
                      <div key={stop.stopId} className={`stop-row ${statusClass}`}>
                        <div className="stop-left">
                          {!isLast && (
                            <div className={`stop-line ${isPassed && !isBusAfterThis ? 'passed' : 'upcoming'}`}>
                              {isBusAfterThis && (
                                <>
                                  <div className="line-segment-passed" style={{ height: `${busSegmentProgress}%` }} />
                                  <div className="timeline-bus-badge pulsing-bus" style={{ top: `${busSegmentProgress}%` }}>
                                    <Bus size={11} className="timeline-bus-icon" />
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {isBusHere ? (
                            <div className="timeline-bus-badge stop-overlay pulsing-bus">
                              <Bus size={11} className="timeline-bus-icon" />
                            </div>
                          ) : (
                            <div className={`stop-dot ${statusClass}`}>
                              {idx === nextUpcomingIdx && <div className="pulse-ring" />}
                            </div>
                          )}
                        </div>

                        <div className="stop-body">
                          <div className="stop-name">{stop.name}</div>
                          <div className="stop-sub">Uttar Pradesh</div>
                        </div>

                        <div className="stop-right">
                          {isPassed ? (
                            <span className="stop-badge passed-badge">Passed</span>
                          ) : stop.status === 'on_stop' ? (
                            <span className="stop-badge on-stop-badge">On Stop</span>
                          ) : (stop.status === 'arriving_now' || stop.status === 'arriving_soon') ? (
                            <span className="stop-badge arriving-badge">Arriving Now</span>
                          ) : (
                            <span className="stop-badge upcoming-badge" style={{ background: 'var(--accent)', color: '#000', fontWeight: 'bold' }}>✨ AI ~{stop.etaMinutes}m</span>
                          )}
                          {stop.distanceRemainingKm > 0 && (
                            <span className="stop-dist">{stop.distanceRemainingKm.toFixed(1)} km</span>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* ── Search Results Area (Sidebar) ── */}
          {!showTrackingPanel && hasSearched && !loading && (
            <div className="results-area">
              {/* Journey planner result */}
              {viewMode === 'journey' && displayJourneys.length > 0 && (
                <div className="journey-options-container">
                  <div className="journey-options-title">Available Ways ({displayJourneys.length})</div>
                  <div className="journey-options-list">
                    {displayJourneys.map((j, idx) => {
                      const isSelected = idx === selectedJourneyIdx;
                      return (
                        <div
                          key={idx}
                          className={`journey-option-card ${isSelected ? 'active' : ''}`}
                          onClick={() => setSelectedJourneyIdx(idx)}
                        >
                          <div className="option-header">
                            <span className="option-badge">Option {idx + 1}</span>
                            {j.totalTransfers === 0 ? (
                              <span className="direct-badge">
                                ⚡ {getDistinguishingStop(j, displayJourneys, from, to) === 'Direct' ? 'Direct' : `via ${getDistinguishingStop(j, displayJourneys, from, to)}`}
                              </span>
                            ) : (
                              <span className="transfer-badge-pill">🔄 {j.totalTransfers} Change{j.totalTransfers > 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <div className="option-details">
                            <div className="option-stops-summary">
                              {j.legs.map((leg, lidx) => (
                                <Fragment key={lidx}>
                                  <span>{leg.from}</span>
                                  <ArrowRight size={10} className="inline-arrow" />
                                </Fragment>
                              ))}
                              <span>{j.legs[j.legs.length - 1].to}</span>
                            </div>
                            <div className="option-meta">
                              <span>⏱ ~{fmtDuration(j.totalDurationMins)}</span>
                              <span className="dot">•</span>
                              <span>📍 {j.totalDistanceKm} km</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Selected Journey Timeline Details in Sidebar */}
                  {journey && (
                    <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '16px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        🗺 Journey Details (Option {selectedJourneyIdx + 1})
                      </div>
                      <JourneyTimeline journey={journey} onTrackBus={handleTrackBus} />
                    </div>
                  )}
                </div>
              )}

              {/* Direct routes */}
              {hasDirectRoutes && (
                <div className="direct-routes">
                  {viewMode === 'journey' && <div className="direct-header" style={{ marginTop: '20px', marginBottom: '8px' }}>Alternative Direct Routes</div>}
                  {displayRoutes.map(({ route, viaText }, i) => {
                    const isSelected = i === selectedRouteIdx;
                    return (
                      <div 
                        key={route.id} 
                        className={`route-card ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedRouteIdx(i)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="route-top">
                          <div>
                            <div className="route-name">
                              {from && to ? `${from} → ${to}` : route.route_name}
                            </div>
                            {from && to && (
                              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px', fontWeight: 500 }}>
                                Bus towards {route.destination || 'Destination'} {viaText ? `(via ${viaText})` : ''}
                              </div>
                            )}
                          </div>
                          <div className="route-dist">
                            {parseFloat(route.distance_km).toFixed(0)} km
                            {route.nextTrips && route.nextTrips.length > 0 && (
                              <span style={{
                                marginLeft: '6px',
                                fontSize: '11px',
                                color: '#fbbf24',
                                background: 'rgba(251, 191, 36, 0.1)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 'bold'
                              }}>
                                [{route.nextTrips[0].busRegNo}]
                              </span>
                            )}
                          </div>
                        </div>
                        {!route.missedTrips?.length && !route.nextTrips?.length ? (
                          <div className="no-trips">No active buses right now</div>
                        ) : (
                          <>
                            {route.missedTrips && route.missedTrips.length > 0 && (
                              <div className="missed-trips-banner" style={{ background: 'rgba(245, 158, 11, 0.1)', borderLeft: '4px solid #FFA000', padding: '10px', borderRadius: '4px', marginBottom: '8px', fontSize: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                  <AlertCircle size={16} color="#FFA000" style={{ marginTop: '2px' }} />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, color: '#ff9f1c', marginBottom: '2px' }}>
                                      Bus {route.missedTrips[0].busRegNo} left {route.missedTrips[0].passedMinutesAgo} mins ago
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '11px', marginBottom: '6px' }}>
                                      It is currently near {route.missedTrips[0].currentNextStop}.
                                    </div>
                                    <button
                                      className="track-btn-small"
                                      style={{ background: '#FFA000', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleTrackBus(route.missedTrips[0].tripId, route.missedTrips[0].busRegNo, route.missedTrips[0].routeCode);
                                      }}
                                    >
                                      <Navigation size={11} /> Track Missed Bus
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                            
                            {route.nextTrips && route.nextTrips.length > 0 && (
                              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', marginTop: '12px' }}>Upcoming Buses</div>
                            )}
                            {route.nextTrips && route.nextTrips.map(trip => (
                              <div key={trip.tripId} style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'rgba(255,255,255,0.03)', padding: '8px 10px', borderRadius: '8px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <div className="trip-row" style={{ margin: 0, padding: 0, background: 'transparent' }}>
                                  <div className="trip-info">
                                    <Bus size={13} color="#38bdf8" />
                                    <span className="trip-reg" style={{ fontWeight: 700 }}>{trip.busRegNo}</span>
                                    <span className="trip-type">{trip.busType}</span>
                                    {trip.etaToBoardingMinutes === 0 ? (
                                      <span className="live-speed-tag" style={{ marginLeft: '4px' }}>Arriving</span>
                                    ) : (
                                      <span className="eta-tag" style={{ marginLeft: '4px', background: 'rgba(59, 130, 246, 0.2)', color: '#38bdf8', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                                        In {trip.etaToBoardingMinutes} min
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    className="track-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleTrackBus(trip.tripId, trip.busRegNo, trip.routeCode);
                                    }}
                                  >
                                    <Navigation size={13} /> Track
                                  </button>
                                </div>
                                <div style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: '4px' }}>
                                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }}></span>
                                  <span>Bus Status: <strong style={{ color: '#f1f5f9' }}>{trip.currentNextStop && trip.currentNextStop !== 'En-route' ? (trip.currentNextStop.startsWith('Near ') || trip.currentNextStop.startsWith('At ') ? trip.currentNextStop : `Near ${trip.currentNextStop}`) : (trip.stops && trip.stops.length > 0 ? `At ${trip.stops[0].name}` : 'En-route')}</strong></span>
                                  {trip.etaToBoardingMinutes !== undefined && (
                                    <span style={{ color: '#38bdf8', marginLeft: '6px' }}>• ~{trip.etaToBoardingMinutes}m to your stop</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* No results */}
              {!hasJourney && !hasDirectRoutes && (
                <div className="no-results">
                  <AlertCircle size={32} />
                  <div>No routes found</div>
                  <div className="no-results-hint">Try: Saharanpur → Meerut, Lucknow → Prayagraj</div>
                </div>
              )}
            </div>
          )}

          {/* Default initial state (popular search chips inside sidebar) */}
          {!hasSearched && !showTrackingPanel && (
            <div className="sample-queries" style={{ marginTop: '12px' }}>
              <div className="sample-label">Popular Routes:</div>
              <div className="sample-chips" style={{ justifyContent: 'flex-start' }}>
                {[
                  ['Saharanpur', 'Gangoh'],
                  ['Saharanpur', 'Meerut'],
                  ['Lucknow', 'Prayagraj'],
                  ['Gorakhpur', 'Varanasi'],
                  ['Jhansi', 'Kanpur'],
                  ['Meerut', 'Delhi']
                ].map(([f, t]) => (
                  <button key={f + t} className="sample-chip" onClick={() => { setFrom(f); setTo(t); setViewMode('journey'); }}>
                    {f} → {t}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── Right Panel: 100% Full-Bleed Leaflet Map ── */}
        <section className={`map-section ${mobileTab === 'map' ? 'mobile-panel-active' : 'mobile-panel-hidden'}`}>
          {showTrackingPanel && liveDetails && !liveDetails.error ? (
            <div className="map-wrapper" style={{ width: '100%', height: '100%', position: 'relative' }}>
              <LiveMap
                latitude={liveDetails.busLatitude || (filteredStops.length > 0 ? filteredStops[0].latitude : 26.8467)}
                longitude={liveDetails.busLongitude || (filteredStops.length > 0 ? filteredStops[0].longitude : 80.9462)}
                stops={filteredStops}
                busRegNo={liveDetails.busRegNo}
                heading={liveDetails.heading}
                villages={villages}
                reports={passengerReports}
                isNavigationMode={isPassenger}
                currentSpeedKmph={liveDetails.currentSpeedKmph}
                onCloseNavigation={() => setIsPassenger(false)}
                routeName={liveDetails.routeName}
              />
              <button className="refresh-fab" onClick={fetchLiveDetailsManual} disabled={isRefreshing} title="Refresh Live Status">
                <RefreshCcw size={22} className={isRefreshing ? 'spin' : ''} />
              </button>
            </div>
          ) : liveDetails?.error ? (
            <div className="map-placeholder">
              <div className="placeholder-inner">
                <Bus size={64} strokeWidth={1} color="#ef4444" />
                <div className="placeholder-title" style={{ color: '#ef4444' }}>Tracking Failed</div>
                <div className="placeholder-sub">{liveDetails.error}</div>
                <button className="btn btn-primary" onClick={() => fetchLiveDetailsManual()} style={{ marginTop: '16px' }}>
                  Try Again
                </button>
              </div>
            </div>
          ) : viewMode === 'journey' && displayJourneys.length > 0 ? (
            <div className="map-wrapper" style={{ width: '100%', height: '100%' }}>
              <LiveMap
                latitude={mapBusLat}
                longitude={mapBusLng}
                stops={[]}
                busRegNo={mapBusRegNo}
                heading={mapBusHeading}
                villages={villages}
                reports={passengerReports}
                currentSpeedKmph={mapBusSpeed}
                routeName={mapBusRouteName}
                multipleRoutes={displayJourneys.map((j, i) => {
                  const allStops = j.legs.flatMap(leg => leg.stops || []).map(s => ({
                    stopId: s.stopId,
                    name: s.name,
                    sequenceNo: s.sequenceNo,
                    latitude: s.latitude,
                    longitude: s.longitude,
                    status: 'upcoming' as const
                  }));
                  const clipped = clipStopsToSegment(allStops, from, to);
                  return {
                    stops: clipped,
                    color: i === selectedJourneyIdx ? '#4f46e5' : '#6b7280',
                    weight: i === selectedJourneyIdx ? 6 : 3,
                    opacity: i === selectedJourneyIdx ? 0.9 : 0.4
                  };
                })}
                onSelectRoute={async (idx) => {
                  setSelectedJourneyIdx(idx);
                  const leg = displayJourneys[idx]?.legs?.[0];
                  const rid = leg?.routeId
                    || routes.find(r => r.route_code === leg?.routeCode)?.id;
                  if (rid) {
                    try {
                      const vRes = await fetch(`${API_BASE}/routes/${rid}/villages`);
                      const vData = await vRes.json();
                      setVillages(vData.villages || []);
                    } catch { setVillages([]); }
                  }
                }}
              />
            </div>
          ) : (displayRoutes.length > 0) ? (
            <div className="map-wrapper" style={{ width: '100%', height: '100%' }}>
              <LiveMap
                latitude={mapBusLat}
                longitude={mapBusLng}
                stops={[]}
                busRegNo={mapBusRegNo}
                heading={mapBusHeading}
                villages={villages}
                reports={passengerReports}
                currentSpeedKmph={mapBusSpeed}
                routeName={mapBusRouteName}
                multipleRoutes={displayRoutes.map(({ route }, i) => ({
                  stops: clipStopsToSegment(route.stops || [], from, to),
                  color: i === selectedRouteIdx ? '#4f46e5' : '#6b7280',
                  weight: i === selectedRouteIdx ? 6 : 3,
                  opacity: i === selectedRouteIdx ? 0.9 : 0.4
                }))}
                onSelectRoute={async (idx) => {
                  setSelectedRouteIdx(idx);
                  try {
                    const vRes = await fetch(`${API_BASE}/routes/${displayRoutes[idx].route.id}/villages`);
                    const vData = await vRes.json();
                    setVillages(vData.villages || []);
                  } catch { setVillages([]); }
                }}
              />
            </div>
          ) : (
            <div className="map-wrapper" style={{ width: '100%', height: '100%' }}>
              <LiveMap
                latitude={26.8467}
                longitude={80.9462}
                stops={[]}
                busRegNo=""
                heading={0}
                villages={villages}
                reports={passengerReports}
              />
            </div>
          )}
        </section>
      </div>

      {/* Passenger Report Modal */}
      {showReportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '16px'
        }}>
          <div className="glass-panel" style={{ maxWidth: '400px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: 'white' }}>⚠️ Report Bus Status</h3>
              <button
                onClick={() => setShowReportModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleReportSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#9ca3af' }}>Select Report Type</label>
                <select
                  value={reportType}
                  onChange={e => setReportType(e.target.value)}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '6px',
                    backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white', outline: 'none'
                  }}
                >
                  <option value="Delay">Delay / Late Running</option>
                  <option value="Overcrowded">Overcrowded Bus</option>
                  <option value="Breakdown">Bus Breakdown / Issue</option>
                  <option value="Cleanliness">Cleanliness Issue</option>
                  <option value="Other">Other Delay / Issue</option>
                </select>
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', color: '#9ca3af' }}>Description (optional)</label>
                <textarea
                  rows={3}
                  placeholder="E.g., Bus is stuck in traffic near the highway bridge."
                  value={reportDesc}
                  onChange={e => setReportDesc(e.target.value)}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '6px',
                    backgroundColor: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white', outline: 'none', resize: 'none'
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowReportModal(false)}
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submittingReport}
                  style={{ flex: 1 }}
                >
                  {submittingReport ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
