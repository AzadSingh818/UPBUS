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
interface NextTrip extends TripLiveDetails { etaToBoardingMinutes: number; }
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

const getDistinguishingStop = (journey: Journey, allJourneys: Journey[]) => {
  if (allJourneys.length <= 1 || journey.totalTransfers > 0 || !journey.legs || journey.legs.length === 0) {
    return 'Direct';
  }

  const currentStops = journey.legs[0].stops || [];
  if (currentStops.length === 0) return 'Direct';

  // Read from leg's source and destination to avoid undefined journey properties
  const fromCity = (journey.legs[0].from || '').toLowerCase();
  const toCity = (journey.legs[0].to || '').toLowerCase();

  // Specific check for Saharanpur <-> Gangoh
  if (
    (fromCity.includes('saharanpur') && toCity.includes('gangoh')) ||
    (fromCity.includes('gangoh') && toCity.includes('saharanpur'))
  ) {
    // Saharanpur to Gangoh (division after Phandpuri/Khera Afgan into Ambehta/Nakur)
    if (fromCity.includes('saharanpur') && toCity.includes('gangoh')) {
      const hasAmbehta = currentStops.some(s => s.name.toLowerCase().includes('ambehta'));
      if (hasAmbehta) return 'Ambehta';
      const hasNakur = currentStops.some(s => s.name.toLowerCase().includes('nakur'));
      if (hasNakur) return 'Nakur';
    }
    // Gangoh to Saharanpur (meeting at Phandpuri)
    if (fromCity.includes('gangoh') && toCity.includes('saharanpur')) {
      const hasPhandpuri = currentStops.some(s => s.name.toLowerCase().includes('phandpuri'));
      if (hasPhandpuri) return 'Phandpuri';
    }
  }

  // General fallback logic:
  // If the route name itself contains "via <StopName>", extract and return it!
  const routeName = journey.legs[0].routeName || '';
  const viaMatch = routeName.match(/\(via\s+([^)]+)\)/i);
  if (viaMatch && viaMatch[1]) {
    return viaMatch[1].trim();
  }

  // Fallback to general distinguishing stop algorithm
  const otherDirectJourneys = allJourneys.filter(oj => oj !== journey && oj.totalTransfers === 0 && oj.legs && oj.legs.length > 0);
  if (otherDirectJourneys.length === 0) return 'Direct';

  for (let i = 1; i < currentStops.length; i++) {
    const currentStopName = currentStops[i].name;
    const hasDifference = otherDirectJourneys.some(oj => {
      const otherStops = oj.legs[0].stops || [];
      return !otherStops[i] || otherStops[i].name !== currentStopName;
    });

    if (hasDifference) {
      return currentStopName
        .replace(/\s+(Bus Stand|Depot|Terminal|Peer|Village)$/i, '')
        .trim();
    }
  }

  return currentStops[1]?.name.replace(/\s+(Bus Stand|Depot|Terminal|Peer|Village)$/i, '').trim() || 'Direct';
};

let API_BASE = 'http://localhost:5000/api/v1';
let WS_BASE = 'ws://localhost:5000';
if (typeof window !== 'undefined') {
  API_BASE = `http://${window.location.hostname}:5000/api/v1`;
  WS_BASE = `ws://${window.location.hostname}:5000`;
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

  const handleFromChange = (val: string) => {
    setFrom(val);
    if (!val.trim()) {
      setFromSuggestions([]);
      return;
    }
    const filtered = allStops.filter(s => 
      s.name.toLowerCase().includes(val.toLowerCase())
    ).slice(0, 10);
    setFromSuggestions(filtered);
    setShowFromSuggestions(true);
  };

  const handleToChange = (val: string) => {
    setTo(val);
    if (!val.trim()) {
      setToSuggestions([]);
      return;
    }
    const filtered = allStops.filter(s => 
      s.name.toLowerCase().includes(val.toLowerCase())
    ).slice(0, 10);
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
  const journey = journeys[selectedJourneyIdx] || null;
  const [hasSearched, setHasSearched] = useState(false);
  const [viewMode, setViewMode] = useState<'direct' | 'journey' | 'bus'>('bus');
  const [busNumber, setBusNumber] = useState('UP11AT0072');

  const [selectedTrip, setSelectedTrip] = useState<ActiveTrip | null>(null);
  const [liveDetails, setLiveDetails] = useState<TripLiveDetails | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [isWebSocket, setIsWebSocket] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [isPassenger, setIsPassenger] = useState(false);
  const [demoPassenger, setDemoPassenger] = useState(true);
  const [trackingSource, setTrackingSource] = useState<'gps' | 'network' | 'cell'>('gps');
  
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
        const res = await fetch(`${API_BASE}/journey?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        const data = await res.json();
        const journeysList = data.journeys || (data.legs ? [data] : []);
        setJourneys(journeysList);
        setSelectedJourneyIdx(0);
        const r2 = await fetch(`${API_BASE}/search/routes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        const d2 = await r2.json();
        setRoutes(d2.routes || []);
        // Fetch villages — use routeId from leg (now included by backend),
        // or fall back to matching routeCode in the direct-routes list
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
        throw new Error('Bus fetch failed');
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

  if (viewMode === 'journey' && journeys.length > 0) {
    const selectedJourney = journeys[selectedJourneyIdx];
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
  } else if (viewMode === 'direct' && routes.length > 0) {
    const selectedRoute = routes[selectedRouteIdx];
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
  const hasDirectRoutes = routes.length > 0;
  const hasJourney = journey && journey.legs && journey.legs.length > 0;
  const showTrackingPanel = liveDetails !== null;

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
        {/* ── Search Panel ── */}
        <aside className="search-panel">
          <form onSubmit={viewMode === 'bus' ? handleSearchBus : handleSearch} className="search-form">
            <div className="search-title">Find Your Bus</div>

            {/* Mode toggle */}
            <div className="mode-toggle">
              <button type="button" className={`mode-btn ${viewMode === 'bus' ? 'active' : ''}`} onClick={() => setViewMode('bus')}>
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

          {/* ── Results ── */}
          {hasSearched && !loading && (
            <div className="results-area">
              {/* Journey planner result */}
              {viewMode === 'journey' && journeys.length > 0 && (
                <div className="journey-options-container">
                  <div className="journey-options-title">Available Ways ({journeys.length})</div>
                  <div className="journey-options-list">
                    {journeys.map((j, idx) => {
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
                                ⚡ {getDistinguishingStop(j, journeys) === 'Direct' ? 'Direct' : `via ${getDistinguishingStop(j, journeys)}`}
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
                  
                  {journey && (
                    <JourneyTimeline journey={journey} onTrackBus={handleTrackBus} />
                  )}
                </div>
              )}

              {/* Direct routes */}
              {hasDirectRoutes && (
                <div className="direct-routes">
                  {viewMode === 'journey' && <div className="direct-header" style={{ marginTop: '20px', marginBottom: '8px' }}>Alternative Direct Routes</div>}
                  {routes.map((route, i) => {
                    const isSelected = i === selectedRouteIdx;
                    return (
                      <div 
                        key={route.id} 
                        className={`route-card ${isSelected ? 'active' : ''}`}
                        onClick={() => setSelectedRouteIdx(i)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="route-top">
                          <div className="route-name">{route.route_name}</div>
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
                              <div key={trip.tripId} className="trip-row">
                                <div className="trip-info">
                                  <Bus size={13} />
                                  <span className="trip-reg">{trip.busRegNo}</span>
                                  <span className="trip-type">{trip.busType}</span>
                                  {trip.etaToBoardingMinutes === 0 ? (
                                    <span className="live-speed-tag" style={{ marginLeft: '4px' }}>Arriving</span>
                                  ) : (
                                    <span className="eta-tag" style={{ marginLeft: '4px', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
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
        </aside>

        {/* ── Right Panel: Map + Tracking ── */}
        <section className="map-section">
          {showTrackingPanel && liveDetails && !liveDetails.error ? (
            <div className="tracking-panel">
              {/* Tracking Header */}
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
                    <div className="last-updated" style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px', marginRight: '8px' }}>
                      Updated: {lastUpdated.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                      <button onClick={fetchLiveDetailsManual} disabled={isRefreshing} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', marginLeft: '4px', padding: 0 }}>
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
                      {(liveDetails as any).trackingMethod === 'gps' ? 'Crowd-Sourced GPS' : 
                       (liveDetails as any).trackingMethod === 'network' ? 'Network Inferred' : 'Cell Tower Triangulation'}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons for Report & Notification */}
              <div style={{ display: 'flex', gap: '8px', padding: '0 16px 12px 16px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowReportModal(true)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px', padding: '8px 12px' }}
                >
                  ⚠️ Report Status
                </button>
                <button
                  type="button"
                  className={`btn ${isSubscribed ? 'btn-danger' : 'btn-primary'}`}
                  onClick={handleNotificationToggle}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '13px', padding: '8px 12px' }}
                >
                  🔔 {isSubscribed ? 'Disable Alerts' : 'Notify Me'}
                </button>
              </div>

              {/* Inside the Bus Panel */}
              <div className="passenger-toggle-card">
                <div className="passenger-toggle-row">
                  <div className="toggle-left">
                    <div className="toggle-label">Are you inside this bus?</div>
                    <div className="toggle-sublabel">Share your phone location to update live arrival times for waiting passengers</div>
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
                  <div className="passenger-settings-panel">
                    <div className="settings-section">
                      <div className="settings-label">Tracking Mode:</div>
                      <div className="tracking-options">
                        <button
                          type="button"
                          className={`track-option-btn ${trackingSource === 'gps' ? 'active' : ''}`}
                          onClick={() => setTrackingSource('gps')}
                        >
                          ⚡ Geolocation GPS
                        </button>
                        <button
                          type="button"
                          className={`track-option-btn ${trackingSource === 'network' ? 'active' : ''}`}
                          onClick={() => setTrackingSource('network')}
                        >
                          📶 Network Info
                        </button>
                        <button
                          type="button"
                          className={`track-option-btn ${trackingSource === 'cell' ? 'active' : ''}`}
                          onClick={() => setTrackingSource('cell')}
                        >
                          🗼 Cell Triangulation
                        </button>
                      </div>
                    </div>

                    <div className="demo-checkbox-row">
                      <input
                        type="checkbox"
                        id="demo-mode-checkbox"
                        checked={demoPassenger}
                        onChange={e => setDemoPassenger(e.target.checked)}
                      />
                      <label htmlFor="demo-mode-checkbox" className="demo-label">
                        Enable Demo Passenger Mode (Simulates movement along route)
                      </label>
                    </div>

                    <div className="location-sharing-indicator">
                      <span className="sharing-dot pulse-green"></span>
                      <span>
                        {demoPassenger ? 'Simulating passenger location updates...' : 'Broadcasting real browser Geolocation...'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Live Map */}
              {(() => {
                const fromQuery = (from || '').toLowerCase().trim();
                const toQuery = (to || '').toLowerCase().trim();

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

                const filteredStops = liveDetails.stops.slice(sIdx, eIdx + 1);

                return (
                  <>
                    <div className="map-wrapper">
                      <LiveMap
                        latitude={liveDetails.busLatitude}
                        longitude={liveDetails.busLongitude}
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
                    </div>

                    {/* Stops Timeline — "Where is my train" style */}
                    <div className="stops-timeline">
                      <div className="stops-title">🗺 Stops & Live Progress</div>
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

                          return (
                            <div key={stop.stopId} className={`stop-row ${statusClass}`}>
                              <div className="stop-left">
                                {/* Stop Line */}
                                {!isLast && (
                                  <div className={`stop-line ${isPassed && !isBusAfterThis ? 'passed' : 'upcoming'}`}>
                                    {/* Draw split colored line segment if the bus is between this stop and next */}
                                    {isBusAfterThis && (
                                      <>
                                        <div className="line-segment-passed" />
                                        <div className="line-segment-upcoming" />
                                        <div className="timeline-bus-badge pulsing-bus">
                                          <Bus size={11} className="timeline-bus-icon" />
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}

                                {/* Dot or Bus overlay */}
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
                                  <span className="stop-badge upcoming-badge">~{stop.etaMinutes}m</span>
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
                  </>
                );
              })()}

              {/* Refresh FAB */}
              <button 
                className="refresh-fab" 
                onClick={fetchLiveDetailsManual}
                disabled={isRefreshing}
                title="Refresh Live Status"
              >
                <RefreshCcw size={22} className={isRefreshing ? 'spin' : ''} />
              </button>
            </div>
          ) : liveDetails?.error ? (
            <div className="map-placeholder">
              <div className="placeholder-inner">
                <Bus size={64} strokeWidth={1} color="#ef4444" />
                <div className="placeholder-title" style={{color: '#ef4444'}}>Tracking Failed</div>
                <div className="placeholder-sub">{liveDetails.error}</div>
                <button className="btn btn-primary" onClick={() => fetchLiveDetailsManual()} style={{marginTop: '16px'}}>
                  Try Again
                </button>
              </div>
            </div>
          ) : viewMode === 'journey' && journeys.length > 0 ? (
            <div className="map-wrapper">
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
                multipleRoutes={journeys.map((j, i) => {
                  // Flatten all leg stops then clip to the passenger's from→to segment
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
                  // Fetch villages — routeId from leg or routeCode fallback
                  const leg = journeys[idx]?.legs?.[0];
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
          ) : viewMode === 'direct' && routes.length > 0 ? (
            <div className="map-wrapper">
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
                multipleRoutes={routes.map((r, i) => ({
                  // Clip full route stops to only the passenger's from→to segment
                  stops: clipStopsToSegment(r.stops || [], from, to),
                  color: i === selectedRouteIdx ? '#4f46e5' : '#6b7280',
                  weight: i === selectedRouteIdx ? 6 : 3,
                  opacity: i === selectedRouteIdx ? 0.9 : 0.4
                }))}
                onSelectRoute={async (idx) => {
                  setSelectedRouteIdx(idx);
                  // Fetch villages for newly selected route
                  try {
                    const vRes = await fetch(`${API_BASE}/routes/${routes[idx].id}/villages`);
                    const vData = await vRes.json();
                    setVillages(vData.villages || []);
                  } catch { setVillages([]); }
                }}
              />
            </div>
          ) : (
            <div className="map-placeholder">
              <div className="placeholder-inner">
                <Bus size={64} strokeWidth={1} />
                <div className="placeholder-title">UP Bus Live Tracker</div>
                <div className="placeholder-sub">Search a route to plan your journey or track a live bus on the map</div>
                <div className="sample-queries">
                  <div className="sample-label">Try searching:</div>
                  <div className="sample-chips">
                    {[['Saharanpur','Meerut'],['Lucknow','Prayagraj'],['Gorakhpur','Varanasi'],['Jhansi','Kanpur'],['Meerut','Delhi']].map(([f,t]) => (
                      <button key={f+t} className="sample-chip" onClick={() => { setFrom(f); setTo(t); }}>
                        {f} → {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
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
