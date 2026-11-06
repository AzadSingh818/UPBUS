'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { X, Compass, MapPin, Activity, Radio, Target, Clock, Zap } from 'lucide-react';

interface ActiveBusState {
  busId?: number;
  regNo: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  lastSeen: string;
  routeName?: string;
  currentStop?: string;
  status: string;
  zoneName?: string;
}

interface SingleBusMapProps {
  bus: ActiveBusState;
  onClose: () => void;
  allBuses: ActiveBusState[];
}

export default function SingleBusMap({ bus: initialBus, onClose, allBuses }: SingleBusMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  
  // Real-time dynamic state for live HUD & physics interpolation
  const [currentBus, setCurrentBus] = useState<ActiveBusState>(initialBus);
  const [liveLat, setLiveLat] = useState<number>(initialBus.latitude);
  const [liveLng, setLiveLng] = useState<number>(initialBus.longitude);
  const [liveSpeed, setLiveSpeed] = useState<number>(initialBus.speed);
  const [liveHeading, setLiveHeading] = useState<number>(initialBus.heading);

  const targetBusRef = useRef<ActiveBusState>(initialBus);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(Date.now());
  const lastPanTimeRef = useRef<number>(Date.now());

  // Format ISO hardware ping timestamp cleanly
  const formatPingTime = (rawTs?: string) => {
    if (!rawTs) return 'Just now';
    try {
      const d = new Date(rawTs);
      if (isNaN(d.getTime())) return rawTs;
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const mm = String(d.getUTCMinutes()).padStart(2, '0');
      const ss = String(d.getUTCSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss} UTC (${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    } catch {
      return rawTs;
    }
  };

  // Sync latest backend telemetry from allBuses polling & update target anchor
  useEffect(() => {
    const updated = allBuses.find(b => b.regNo === initialBus.regNo);
    if (updated) {
      targetBusRef.current = updated;
      setCurrentBus(updated);
    }
  }, [allBuses, initialBus.regNo]);

  // Center camera on bus manually when clicking "Center Bus"
  const handleRecenter = () => {
    if (mapRef.current) {
      mapRef.current.flyTo([liveLat, liveLng], 16, { duration: 1 });
    }
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [initialBus.latitude, initialBus.longitude],
      zoom: 16,
      maxZoom: 19,
      minZoom: 4,
      zoomControl: true
    });
    mapRef.current = map;

    // High-Detail OpenStreetMap Layer (Shops, Street Names, Colonies, Area Names, Landmarks)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      maxNativeZoom: 19
    }).addTo(map);

    const getIconHtml = (heading: number, speed: number) => `
      <div style="
        width: 44px;
        height: 44px;
        background: ${speed >= 5 ? '#10b981' : '#f59e0b'};
        border: 3px solid #090d16;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 24px ${speed >= 5 ? 'rgba(16, 185, 129, 0.9)' : 'rgba(245, 158, 11, 0.9)'};
        transform: rotate(${heading}deg);
        transition: transform 0.2s ease, background 0.3s ease;
      ">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
          <rect x="9" y="18" width="6" height="3"></rect>
          <path d="M4 14h16"></path>
          <circle cx="8" cy="9" r="1.5"></circle>
          <circle cx="16" cy="9" r="1.5"></circle>
        </svg>
      </div>
    `;

    const customIcon = L.divIcon({
      html: getIconHtml(initialBus.heading, initialBus.speed),
      className: 'custom-bus-marker-hybrid',
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    const marker = L.marker([initialBus.latitude, initialBus.longitude], { icon: customIcon }).addTo(map);
    markerRef.current = marker;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, []);

  // Hybrid Smooth Motion Engine (Uber / FlightRadar Style):
  // 1. Continuous Dead-Reckoning Gliding along road trajectory between hardware pings
  // 2. Seamless Re-anchoring to official UPSRTC hardware GPS packets when they arrive
  useEffect(() => {
    let currLat = initialBus.latitude;
    let currLng = initialBus.longitude;
    let currSpeed = initialBus.speed;
    let currHeading = initialBus.heading;

    const animateLoop = () => {
      const now = Date.now();
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.2); // delta time in seconds
      lastTimeRef.current = now;

      const target = targetBusRef.current;

      // 1. Smoothly lerp speed & heading towards latest hardware target
      currSpeed += (target.speed - currSpeed) * 0.05;

      let headingDiff = (target.heading - currHeading) % 360;
      if (headingDiff > 180) headingDiff -= 360;
      if (headingDiff < -180) headingDiff += 360;
      currHeading += headingDiff * 0.05;

      const headingDisplay = (currHeading + 360) % 360;

      // 2. Dead-Reckoning Gliding along trajectory if bus is RUNNING
      if (currSpeed >= 5) {
        const latDist = target.latitude - currLat;
        const lngDist = target.longitude - currLng;
        const totalDistToTarget = Math.sqrt(latDist * latDist + lngDist * lngDist);

        if (totalDistToTarget < 0.00005) {
          // Dead Reckoning Extrapolation: Even if we reached the last ping point,
          // the bus has speed > 5 km/h, so KEEP MOVING forward along current heading!
          const speedMetersPerSec = (currSpeed * 1000) / 3600;
          const distanceMeters = speedMetersPerSec * dt;
          const radHeading = (currHeading * Math.PI) / 180;

          const deltaLat = (distanceMeters * Math.cos(radHeading)) / 111320;
          const deltaLng = (distanceMeters * Math.sin(radHeading)) / (111320 * Math.cos((currLat * Math.PI) / 180));

          currLat += deltaLat;
          currLng += deltaLng;
        } else {
          // Calculate direct bearing towards target hardware position
          const targetRadBearing = Math.atan2(lngDist * Math.cos((currLat * Math.PI) / 180), latDist);
          const targetBearingDeg = (targetRadBearing * 180 / Math.PI + 360) % 360;

          // Smoothly rotate compass heading to match travel vector
          let bDiff = (targetBearingDeg - currHeading) % 360;
          if (bDiff > 180) bDiff -= 360;
          if (bDiff < -180) bDiff += 360;
          currHeading += bDiff * 0.1;

          // Motion vector is 100% aligned with target direction
          const speedMetersPerSec = (currSpeed * 1000) / 3600;
          const distanceMeters = speedMetersPerSec * dt;

          const deltaLat = (distanceMeters * Math.cos(targetRadBearing)) / 111320;
          const deltaLng = (distanceMeters * Math.sin(targetRadBearing)) / (111320 * Math.cos((currLat * Math.PI) / 180));

          currLat += deltaLat;
          currLng += deltaLng;

          // Smooth catch-up lerp towards target
          const lerpFactor = currSpeed > 35 ? 0.08 : 0.03;
          currLat += latDist * lerpFactor;
          currLng += lngDist * lerpFactor;
        }
      } else {
        // Halted / Depot: Satellite Jitter Noise Filter (< 3 meters jitter ignored to prevent stationary marker shaking)
        const latDist = target.latitude - currLat;
        const lngDist = target.longitude - currLng;
        const totalJitterDist = Math.sqrt(latDist * latDist + lngDist * lngDist);
        if (totalJitterDist > 0.00003) {
          currLat += latDist * 0.05;
          currLng += lngDist * 0.05;
        }
      }

      // Update React state for Live Telemetry HUD cards
      setLiveLat(currLat);
      setLiveLng(currLng);
      setLiveSpeed(Math.max(0, currSpeed));
      setLiveHeading(headingDisplay);

      // Update Leaflet Marker Position & Icon
      if (markerRef.current) {
        const newLatLng = L.latLng(currLat, currLng);
        markerRef.current.setLatLng(newLatLng);

        const getIconHtml = (heading: number, speed: number) => `
          <div style="
            width: 44px;
            height: 44px;
            background: ${speed >= 5 ? '#10b981' : '#f59e0b'};
            border: 3px solid #090d16;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 24px ${speed >= 5 ? 'rgba(16, 185, 129, 0.9)' : 'rgba(245, 158, 11, 0.9)'};
            transform: rotate(${heading}deg);
            transition: transform 0.15s ease;
          ">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
              <rect x="9" y="18" width="6" height="3"></rect>
              <path d="M4 14h16"></path>
              <circle cx="8" cy="9" r="1.5"></circle>
              <circle cx="16" cy="9" r="1.5"></circle>
            </svg>
          </div>
        `;

        markerRef.current.setIcon(L.divIcon({
          html: getIconHtml(headingDisplay, currSpeed),
          className: 'custom-bus-marker-hybrid',
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }));

        // Smart Camera Bounds Follow: Pan camera every 4 seconds or when near viewport edge
        if (mapRef.current) {
          const bounds = mapRef.current.getBounds();
          const isNearEdge = !bounds.pad(-0.2).contains(newLatLng);
          
          if (isNearEdge || now - lastPanTimeRef.current > 4000) {
            lastPanTimeRef.current = now;
            mapRef.current.panTo(newLatLng, { animate: true, duration: 1 });
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(animateLoop);
    };

    lastTimeRef.current = Date.now();
    animationFrameRef.current = requestAnimationFrame(animateLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(5, 7, 12, 0.88)',
      backdropFilter: 'blur(10px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '1280px',
        height: '86vh',
        background: '#090d16',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 60px rgba(0,0,0,0.85)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          background: '#0d1321',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{
                fontFamily: 'monospace',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '4px 10px',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '15px',
                letterSpacing: '0.5px'
              }}>{currentBus.regNo}</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>
                {currentBus.routeName || 'Dynamic Live Corridor'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Status:</span>
              <span style={{ 
                color: liveSpeed >= 5 ? '#10b981' : '#f59e0b', 
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: liveSpeed >= 5 ? '#10b981' : '#f59e0b',
                  display: 'inline-block'
                }}></span>
                {liveSpeed >= 5 ? `RUNNING (${Math.round(liveSpeed)} KM/H)` : 'HALTED / DEPOT'}
              </span>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Recenter Button */}
            <button
              onClick={handleRecenter}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '20px',
                padding: '6px 12px',
                fontSize: '12px',
                color: '#d1d5db',
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
                e.currentTarget.style.color = '#38bdf8';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.color = '#d1d5db';
              }}
            >
              <Target size={14} />
              Center Bus
            </button>

            {/* Hybrid Streaming Badge */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              padding: '6px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              color: '#10b981',
              fontWeight: 600
            }}>
              <Zap size={14} style={{ color: '#10b981' }} />
              HYBRID LIVE STREAM (UBER / FLIGHTRADAR MODE)
            </div>

            <button 
              onClick={onClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                e.currentTarget.style.color = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.color = '#9ca3af';
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
          {/* Leaflet Map */}
          <div ref={mapContainerRef} style={{ flex: 1, height: '100%', background: '#05070c' }} />

          {/* HUD Telemetry Sidebar Panel */}
          <div style={{
            width: '350px',
            background: 'rgba(13, 19, 33, 0.96)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            color: '#d1d5db',
            zIndex: 1000,
            overflowY: 'auto'
          }}>
            <h3 style={{ margin: 0, fontSize: '12px', textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '1px', fontWeight: 700 }}>
              Live Telemetry HUD
            </h3>
            
            {/* Speed & Heading Gauge Cards */}
            <div style={{ display: 'flex', gap: '10px' }}>
              {/* Speed Card */}
              <div style={{ 
                flex: 1, 
                background: 'rgba(255,255,255,0.03)', 
                padding: '12px', 
                borderRadius: '10px', 
                border: '1px solid rgba(255,255,255,0.06)',
                boxShadow: liveSpeed >= 5 ? 'inset 0 0 12px rgba(16, 185, 129, 0.1)' : 'none'
              }}>
                <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Speed</div>
                <div style={{ 
                  fontSize: '20px', 
                  fontWeight: 800, 
                  color: liveSpeed >= 5 ? '#10b981' : '#f59e0b', 
                  marginTop: '2px',
                  fontFamily: 'monospace'
                }}>
                  {Math.round(liveSpeed)} <span style={{ fontSize: '10px', fontWeight: 500, color: '#9ca3af' }}>km/h</span>
                </div>
              </div>

              {/* Heading Card */}
              <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600 }}>Heading</div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#f3f4f6', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'monospace' }}>
                  <Compass size={16} style={{ transform: `rotate(${liveHeading}deg)`, color: '#f59e0b', transition: 'transform 0.2s linear' }} />
                  {Math.round(liveHeading)}°
                </div>
              </div>
            </div>

            {/* Coordinates Stream Card */}
            <div style={{ 
              background: 'rgba(255,255,255,0.03)', 
              padding: '14px', 
              borderRadius: '10px', 
              border: '1px solid rgba(56, 189, 248, 0.15)',
              boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
            }}>
              <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                <span>Coordinates</span>
                <span style={{ color: '#38bdf8', fontSize: '9px' }}>HIGH-PRECISION GPS</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace', fontSize: '13px', color: '#38bdf8', fontWeight: 600 }}>
                <MapPin size={15} style={{ color: '#38bdf8' }} />
                {liveLat.toFixed(6)}, {liveLng.toFixed(6)}
              </div>
            </div>

            {/* Destination Status */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>Destination Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#f3f4f6', fontWeight: 600 }}>
                <Activity size={15} style={{ color: '#10b981' }} />
                {currentBus.currentStop || 'En-route'}
              </div>
            </div>

            {/* Regional District */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 600 }}>Regional District</div>
              <div style={{ fontSize: '12px', color: '#a78bfa', fontWeight: 600, lineHeight: '1.4' }}>
                {currentBus.zoneName || 'Uttar Pradesh, India'}
              </div>
            </div>

            {/* Last Hardware Ping Card - Clean Formatted & Fully Visible */}
            <div style={{ 
              background: 'rgba(255,255,255,0.03)', 
              padding: '12px 14px', 
              borderRadius: '10px', 
              border: '1px solid rgba(245, 158, 11, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={13} style={{ color: '#f59e0b' }} />
                Last Hardware Ping
              </div>
              <div style={{ fontSize: '12px', color: '#f3f4f6', fontWeight: 700, fontFamily: 'monospace' }}>
                {formatPingTime(currentBus.lastSeen)}
              </div>
            </div>

            {/* Pulsing Sync Footer */}
            <div style={{ marginTop: 'auto', paddingTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#9ca3af' }}>
              <span className="live-indicator-dot" style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px #10b981',
                animation: 'pulse 1.5s infinite'
              }}></span>
              Hybrid Motion Engine Active
            </div>
            
            <style>{`
              @keyframes pulse {
                0% { opacity: 0.4; }
                50% { opacity: 1; }
                100% { opacity: 0.4; }
              }
              @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
              .custom-bus-marker-hybrid {
                transition: left 0.15s linear, top 0.15s linear !important;
              }
            `}</style>
          </div>
        </div>
      </div>
    </div>
  );
}
