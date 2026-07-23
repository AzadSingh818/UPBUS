'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { X, Compass, MapPin, Activity } from 'lucide-react';

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
  const [currentBus, setCurrentBus] = useState<ActiveBusState>(initialBus);

  // Sync state from live updates (which are polled every 1s)
  useEffect(() => {
    const updated = allBuses.find(b => b.regNo === initialBus.regNo);
    if (updated) {
      setCurrentBus(updated);
    }
  }, [allBuses, initialBus.regNo]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Center map on the bus
    const map = L.map(mapContainerRef.current, {
      center: [currentBus.latitude, currentBus.longitude],
      zoom: 14,
      maxZoom: 18,
      minZoom: 4,
    });
    mapRef.current = map;

    // Dark Mode tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Custom glowing Bus Icon HTML
    const getIconHtml = (heading: number, speed: number) => `
      <div style="
        width: 38px;
        height: 38px;
        background: ${speed >= 5 ? '#10b981' : '#f59e0b'};
        border: 2px solid #090d16;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 15px ${speed >= 5 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(245, 158, 11, 0.7)'};
        transform: rotate(${heading}deg);
        transition: transform 0.3s ease, background 0.3s ease;
      ">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
          <rect x="9" y="18" width="6" height="3"></rect>
          <path d="M4 14h16"></path>
          <circle cx="8" cy="9" r="1.5"></circle>
          <circle cx="16" cy="9" r="1.5"></circle>
        </svg>
      </div>
    `;

    const customIcon = L.divIcon({
      html: getIconHtml(currentBus.heading, currentBus.speed),
      className: 'custom-bus-marker',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    const marker = L.marker([currentBus.latitude, currentBus.longitude], { icon: customIcon }).addTo(map);
    markerRef.current = marker;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, []);

  // Update marker position & map panning on bus update
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;

    const latLng = L.latLng(currentBus.latitude, currentBus.longitude);
    mapRef.current.panTo(latLng);
    markerRef.current.setLatLng(latLng);

    const getIconHtml = (heading: number, speed: number) => `
      <div style="
        width: 38px;
        height: 38px;
        background: ${speed >= 5 ? '#10b981' : '#f59e0b'};
        border: 2px solid #090d16;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 15px ${speed >= 5 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(245, 158, 11, 0.7)'};
        transform: rotate(${heading}deg);
        transition: transform 0.3s ease, background 0.3s ease;
      ">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
          <rect x="9" y="18" width="6" height="3"></rect>
          <path d="M4 14h16"></path>
          <circle cx="8" cy="9" r="1.5"></circle>
          <circle cx="16" cy="9" r="1.5"></circle>
        </svg>
      </div>
    `;

    markerRef.current.setIcon(L.divIcon({
      html: getIconHtml(currentBus.heading, currentBus.speed),
      className: 'custom-bus-marker',
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    }));
  }, [currentBus.latitude, currentBus.longitude, currentBus.speed, currentBus.heading]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(5, 7, 12, 0.85)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '1200px',
        height: '80vh',
        background: '#090d16',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 50px rgba(0,0,0,0.8)'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          background: '#0d1321',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                fontFamily: 'monospace',
                background: 'rgba(245, 158, 11, 0.15)',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '4px 8px',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '14px'
              }}>{currentBus.regNo}</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>
                {currentBus.routeName || 'Dynamic Discovery'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
              Current Status: <span style={{ color: currentBus.speed >= 5 ? '#10b981' : '#f87171', fontWeight: 600 }}>{currentBus.speed >= 5 ? 'MOVING' : 'HALTED'}</span>
            </div>
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

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
          {/* Map Container */}
          <div ref={mapContainerRef} style={{ flex: 1, height: '100%', background: '#05070c' }} />

          {/* Sidebar */}
          <div style={{
            width: '320px',
            background: 'rgba(13, 19, 33, 0.95)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            color: '#d1d5db',
            zIndex: 1000,
            overflowY: 'auto'
          }}>
            <h3 style={{ margin: 0, fontSize: '13px', textTransform: 'uppercase', color: '#9ca3af', letterSpacing: '1px' }}>
              Telemetry Info
            </h3>
            
            {/* Speed & Heading */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' }}>Speed</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#f3f4f6', marginTop: '4px' }}>
                  {Math.round(currentBus.speed)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#9ca3af' }}>km/h</span>
                </div>
              </div>
              <div style={{ flex: 1, background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase' }}>Heading</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#f3f4f6', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Compass size={16} style={{ transform: `rotate(${currentBus.heading}deg)`, color: '#f59e0b' }} />
                  {Math.round(currentBus.heading)}°
                </div>
              </div>
            </div>

            {/* Coordinates */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '8px' }}>Coordinates</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace', fontSize: '13px', color: '#38bdf8' }}>
                <MapPin size={14} />
                {currentBus.latitude.toFixed(6)}, {currentBus.longitude.toFixed(6)}
              </div>
            </div>

            {/* Destination */}
            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '8px' }}>Destination Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#f3f4f6' }}>
                <Activity size={14} style={{ color: '#10b981' }} />
                {currentBus.currentStop || 'En-route'}
              </div>
            </div>

            {/* Region */}
            {currentBus.zoneName && (
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', marginBottom: '8px' }}>Regional District</div>
                <div style={{ fontSize: '13px', color: '#a78bfa' }}>
                  {currentBus.zoneName}
                </div>
              </div>
            )}

            {/* Flashing Status */}
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#9ca3af' }}>
              <span className="live-indicator-dot" style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px #10b981',
                animation: 'pulse 1.5s infinite'
              }}></span>
              Real-time feed active
            </div>
            
            <style>{`
              @keyframes pulse {
                0% { opacity: 0.4; }
                50% { opacity: 1; }
                100% { opacity: 0.4; }
              }
            `}</style>
          </div>
        </div>
      </div>
    </div>
  );
}
