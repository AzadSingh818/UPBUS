'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

interface Stop {
  stopId: number;
  name: string;
  sequenceNo: number;
  latitude: number;
  longitude: number;
  status: 'passed' | 'arriving_soon' | 'arriving_now' | 'on_stop' | 'upcoming';
  distanceRemainingKm?: number;
  etaMinutes?: number;
}

export interface Village {
  name: string;
  latitude: number;
  longitude: number;
}

export interface PassengerReport {
  id: number;
  trip_id?: number | null;
  bus_reg_no: string;
  report_type: string;
  description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
}

interface LiveMapProps {
  latitude: number;
  longitude: number;
  stops: Stop[];
  busRegNo: string;
  heading: number;
  villages?: Village[];
  multipleRoutes?: { stops: Stop[], color?: string, weight?: number, opacity?: number }[];
  onSelectRoute?: (index: number) => void;
  reports?: PassengerReport[];
  isNavigationMode?: boolean;
  currentSpeedKmph?: number;
  onCloseNavigation?: () => void;
  routeName?: string;
}

/**
 * Zoom level above which village LABELS are shown.
 * Village DOTS are always visible; labels appear at higher zoom for readability.
 */
const VILLAGE_LABEL_ZOOM = 11;

export default function LiveMap({
  latitude, longitude, stops, busRegNo, heading,
  villages,
  multipleRoutes, onSelectRoute,
  reports,
  isNavigationMode, currentSpeedKmph, onCloseNavigation, routeName,
}: LiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const busMarkerRef = useRef<any>(null);
  const passedPolylineRef = useRef<any>(null);
  const upcomingPolylineRef = useRef<any>(null);
  const stopMarkersRef = useRef<any[]>([]);
  const villageLayerRef = useRef<any[]>([]); // village markers + dotted lines
  const reportMarkersRef = useRef<any[]>([]);

  // ── Map initialisation & stop/route rendering ──────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    const L = require('leaflet');

    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    });

    // 1. Initialize map
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapContainerRef.current, {
        center: [latitude, longitude],
        zoom: 11,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: '&copy; Google Maps',
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        maxZoom: 20
      }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;

    const resizeTimer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 100);

    // 2. Clear old stop markers
    stopMarkersRef.current.forEach(marker => marker.remove());
    stopMarkersRef.current = [];

    if (multipleRoutes && multipleRoutes.length > 0) {
      multipleRoutes.forEach((route, rIdx) => {
        const validStops = route.stops.filter(s => s.latitude !== undefined && s.longitude !== undefined);
        const latLngs = validStops.map(s => [Number(s.latitude), Number(s.longitude)]);

        if (latLngs.length > 0) {
          const pl = L.polyline(latLngs, {
            color: route.color || '#3b82f6',
            weight: route.weight || 4,
            opacity: route.opacity || 0.8
          }).addTo(map);

          if (onSelectRoute) {
            pl.on('click', () => { onSelectRoute(rIdx); });
            (pl as any).getElement().style.cursor = 'pointer';
          }

          stopMarkersRef.current.push(pl);
        }

        const isSelected = !route.opacity || route.opacity > 0.5;
        if (isSelected) {
          route.stops.forEach((stop, stopIdx) => {
            if (stop.latitude === undefined || stop.longitude === undefined) return;

            const isFirst = stopIdx === 0;
            const isLast = stopIdx === route.stops.length - 1;
            const isVillage = stop.name.toLowerCase().includes('village');

            let innerHtml = '';
            let iconSize: [number, number] = [12, 12];
            let iconAnchor: [number, number] = [6, 6];

            if (isFirst || isLast) {
              iconSize = [20, 20];
              iconAnchor = [10, 10];
              const color = isFirst ? '#10b981' : '#ef4444'; // Green for Start, Red for End
              const label = isFirst ? 'S' : 'E';
              innerHtml = `
                <div style="
                  width: 20px;
                  height: 20px;
                  background-color: ${color};
                  border: 3px solid #ffffff;
                  border-radius: 50%;
                  box-shadow: 0 0 10px ${color};
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  color: white;
                  font-size: 10px;
                  font-weight: bold;
                ">${label}</div>
              `;
            } else {
              innerHtml = `
                <div style="
                  width: 12px; height: 12px;
                  background-color: ${isVillage ? 'var(--accent)' : 'white'};
                  border: 3px solid ${route.color || '#3b82f6'};
                  border-radius: 50%;
                  box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                "></div>
              `;
            }

            const stopIcon = L.divIcon({
              className: 'stop-dot-icon',
              html: innerHtml,
              iconSize,
              iconAnchor
            });

            const m = L.marker([Number(stop.latitude), Number(stop.longitude)], { icon: stopIcon })
              .bindPopup(`<b>${stop.name}</b>`)
              .addTo(map);
            stopMarkersRef.current.push(m);
          });
        }
      });

      const allLatLngs = multipleRoutes
        .flatMap(r => r.stops)
        .filter(s => s.latitude !== undefined && s.longitude !== undefined)
        .map(s => [Number(s.latitude), Number(s.longitude)]);

      if (allLatLngs.length > 0) {
        map.fitBounds(allLatLngs as any, { padding: [50, 50] });
      }
    } else if (stops && stops.length > 0) {
      let lastPassedIndex = -1;
      for (let i = 0; i < stops.length; i++) {
        if (stops[i].status === 'passed') lastPassedIndex = i;
      }

      const validStops = stops.filter(s => s.latitude !== undefined && s.longitude !== undefined);
      const passedLatLngs: any[] = [];
      const upcomingLatLngs: any[] = [];
      const busLatLng = [Number(latitude), Number(longitude)];

      if (validStops.length > 0) {
        validStops.forEach((s, i) => {
          const ll = [Number(s.latitude), Number(s.longitude)];
          if (i <= lastPassedIndex) passedLatLngs.push(ll);
          if (i >= lastPassedIndex) upcomingLatLngs.push(ll);
        });

        if (lastPassedIndex >= 0 && lastPassedIndex < validStops.length - 1) {
          passedLatLngs.push(busLatLng);
          upcomingLatLngs.unshift(busLatLng);
        } else if (lastPassedIndex === -1) {
          upcomingLatLngs.unshift(busLatLng);
        } else if (lastPassedIndex === validStops.length - 1) {
          passedLatLngs.push(busLatLng);
        }

        if (passedPolylineRef.current) passedPolylineRef.current.remove();
        if (upcomingPolylineRef.current) upcomingPolylineRef.current.remove();

        passedPolylineRef.current = L.polyline(passedLatLngs, { color: '#6b7280', weight: 5, opacity: 0.8 }).addTo(map);
        if (isNavigationMode) {
          upcomingPolylineRef.current = L.polyline(upcomingLatLngs, {
            color: '#007aff',
            weight: 7,
            opacity: 0.9,
            lineJoin: 'round'
          }).addTo(map);
        } else {
          upcomingPolylineRef.current = L.polyline(upcomingLatLngs, {
            color: '#3b82f6',
            weight: 5,
            opacity: 0.8,
            dashArray: '8, 8'
          }).addTo(map);
        }
      }

      stops.forEach((stop, idx) => {
        if (stop.latitude === undefined || stop.longitude === undefined) return;

        const isFirst = idx === 0;
        const isLast = idx === stops.length - 1;

        const isPassed  = stop.status === 'passed';
        const isCurrent = stop.status === 'arriving_now' || stop.status === 'arriving_soon';
        const isOnStop  = stop.status === 'on_stop';

        let innerHtml = '';
        let iconSize: [number, number] = [12, 12];
        let iconAnchor: [number, number] = [6, 6];

        if (isFirst || isLast) {
          iconSize = [20, 20];
          iconAnchor = [10, 10];
          const color = isFirst ? '#10b981' : '#ef4444'; // Green for Start, Red for End
          const label = isFirst ? 'S' : 'E';
          innerHtml = `
            <div style="
              width: 20px;
              height: 20px;
              background-color: ${color};
              border: 3px solid #ffffff;
              border-radius: 50%;
              box-shadow: 0 0 10px ${color};
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 10px;
              font-weight: bold;
            ">${label}</div>
          `;
        } else {
          innerHtml = `
            <div style="
              width: 12px; height: 12px;
              background-color: ${isOnStop ? '#10b981' : isCurrent ? '#ff9f1c' : isPassed ? '#4f46e5' : '#6b7280'};
              border: 2px solid #ffffff;
              border-radius: 50%;
              box-shadow: 0 0 8px ${isOnStop ? '#10b981' : isCurrent ? '#ff9f1c' : 'transparent'};
            "></div>
          `;
        }

        const stopIcon = L.divIcon({
          className: 'stop-dot-icon',
          html: innerHtml,
          iconSize,
          iconAnchor
        });

        const stopMarker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
          .addTo(map)
          .bindPopup(`<b>${stop.name}</b><br/>Sequence: ${stop.sequenceNo}<br/>Status: ${stop.status.replace('_', ' ')}`);

        stopMarkersRef.current.push(stopMarker);
      });
    }

    // 3. Bus marker with direction arrow
    let selectedIcon;
    if (isNavigationMode) {
      selectedIcon = L.divIcon({
        className: 'nav-marker-icon',
        html: `
          <div class="nav-marker-wrapper" style="position: relative; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center;">
            <div class="nav-pulse-ring" style="
              position: absolute;
              width: 40px;
              height: 40px;
              background: rgba(0, 122, 255, 0.4);
              border-radius: 50%;
              animation: navPulse 1.8s infinite ease-in-out;
            "></div>
            <div class="nav-arrow-circle" style="
              position: absolute;
              width: 28px;
              height: 28px;
              background: #007aff;
              border: 3px solid #ffffff;
              border-radius: 50%;
              box-shadow: 0 4px 10px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              transform: rotate(${heading}deg);
              transition: transform 0.3s ease-out;
            ">
              <svg viewBox="0 0 24 24" fill="white" style="width: 16px; height: 16px;">
                <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
              </svg>
            </div>
          </div>
        `,
        iconSize: [50, 50],
        iconAnchor: [25, 25]
      });
    } else {
      selectedIcon = L.divIcon({
        className: 'bus-marker-icon',
        html: `
          <div class="bus-marker-wrapper">
            <div class="bus-pulse-ring"></div>
            <div class="bus-direction-arrow" style="transform: rotate(${heading}deg);"></div>
            <div class="bus-icon-circle">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 11.03V7.05c0-2.22-3.23-2.92-6-2.92s-6 .7-6 2.92v3.98c-1.2.35-2 1.34-2 2.53v5.47c0 .83.67 1.5 1.5 1.5h.5v1c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-1h7v1c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-1h.5c.83 0 1.5-.67 1.5-1.5v-5.47c0-1.19-.8-2.18-2-2.53zM7.5 16c-.83 0-1.5-.67-1.5-1.5S6.67 13 7.5 13s1.5.67 1.5 1.5S8.33 16 7.5 16zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V7h12v3z"/>
              </svg>
            </div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });
    }

    const popupContent = `
      <div style="color: black; font-family: Inter, sans-serif; font-size: 13px; min-width: 160px;">
        <b style="color: #4f46e5; font-size: 14px;">🚌 Bus: ${busRegNo}</b><br/>
        <span style="font-weight: 600;">Route:</span> ${routeName || 'Unknown Route'}<br/>
        <span style="font-weight: 600;">Speed:</span> ${Math.round(currentSpeedKmph ?? 0)} km/h<br/>
        <span style="font-weight: 600;">Status:</span> ${stops && stops.length > 0 ? `Heading to ${stops[stops.length-1].name}` : 'Active & Tracking'}
      </div>
    `;

    if (busMarkerRef.current) {
      busMarkerRef.current.setLatLng([latitude, longitude]);
      busMarkerRef.current.setIcon(selectedIcon);
      busMarkerRef.current.setPopupContent(popupContent);
    } else {
      busMarkerRef.current = L.marker([latitude, longitude], { icon: selectedIcon })
        .addTo(map)
        .bindPopup(popupContent);
    }

    if (isNavigationMode) {
      map.setView([latitude, longitude], 15);
    } else {
      map.panTo([latitude, longitude]);
    }

    return () => {
      clearTimeout(resizeTimer);
    };
  }, [latitude, longitude, stops, busRegNo, heading, multipleRoutes, onSelectRoute]);

  // ── Village markers + dotted connector lines ───────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !mapInstanceRef.current) return;

    const L = require('leaflet');
    const map = mapInstanceRef.current;

    // Remove old village layer (markers + dotted lines)
    villageLayerRef.current.forEach(item => item.remove());
    villageLayerRef.current = [];

    if (!villages || villages.length === 0) {
      console.log('[LiveMap] No villages to render');
      return;
    }

    console.log(`[LiveMap] Rendering ${villages.length} villages on map`);

    // Get all stop coordinates for building connector lines
    const allStops = multipleRoutes
      ? multipleRoutes.flatMap(r => r.stops).filter(s => s.latitude && s.longitude)
      : (stops || []).filter(s => s.latitude && s.longitude);

    // ── Draw dotted connector lines from nearest stop to each village ──
    for (const v of villages) {
      // Find the nearest stop to this village
      let nearestStop: { latitude: number; longitude: number } | null = null;
      let nearestDist = Infinity;
      for (const s of allStops) {
        const d = Math.hypot(v.latitude - s.latitude, v.longitude - s.longitude);
        if (d < nearestDist) {
          nearestDist = d;
          nearestStop = s;
        }
      }

      // Draw a small dotted line from nearest stop to village
      if (nearestStop) {
        const dottedLine = L.polyline(
          [[nearestStop.latitude, nearestStop.longitude], [v.latitude, v.longitude]],
          {
            color: '#ff9f1c',
            weight: 2,
            opacity: 0.7,
            dashArray: '4, 6',
          }
        ).addTo(map);
        villageLayerRef.current.push(dottedLine);
      }

      // ── Village dot marker (always visible) ──
      const icon = L.divIcon({
        className: 'village-marker-icon',
        html: `
          <div class="village-marker-wrapper">
            <div class="village-dot"></div>
            <span class="village-label">${v.name}</span>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [4, 4],
      });

      const marker = L.marker([v.latitude, v.longitude], {
        icon,
        interactive: false,
        zIndexOffset: -50,
      }).addTo(map);
      villageLayerRef.current.push(marker);
    }

    // ── Zoom-dependent label visibility (dots always visible, labels zoom-gated) ──
    const updateLabelVisibility = () => {
      const zoom = map.getZoom();
      const showLabels = zoom >= VILLAGE_LABEL_ZOOM;
      // Toggle label span visibility via CSS class
      const labels = map.getContainer().querySelectorAll('.village-label');
      labels.forEach((el: HTMLElement) => {
        el.style.display = showLabels ? '' : 'none';
      });
    };

    updateLabelVisibility();
    map.on('zoomend', updateLabelVisibility);

    return () => {
      map.off('zoomend', updateLabelVisibility);
    };
  }, [villages, stops, multipleRoutes]);

  // ── Render passenger reports on map ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !mapInstanceRef.current) return;

    const L = require('leaflet');
    const map = mapInstanceRef.current;

    // Clear old report markers
    reportMarkersRef.current.forEach(m => m.remove());
    reportMarkersRef.current = [];

    if (!reports || reports.length === 0) return;

    reports.forEach((rep) => {
      if (rep.latitude === undefined || rep.longitude === undefined || rep.latitude === null || rep.longitude === null) return;

      const markerColor = rep.report_type.toLowerCase() === 'delay' ? '#ff3b30' : 
                         rep.report_type.toLowerCase() === 'overcrowded' ? '#ff9500' : '#af52de';

      const iconHtml = `
        <div style="
          width: 24px; height: 24px;
          background-color: ${markerColor};
          border: 2px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 13px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
          cursor: pointer;
        ">⚠️</div>
      `;

      const reportIcon = L.divIcon({
        className: 'passenger-report-icon',
        html: iconHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const timeStr = new Date(rep.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      const popupContent = `
        <div style="color: black; font-family: Inter, sans-serif; font-size: 13px; min-width: 140px;">
          <b style="color: ${markerColor}; text-transform: uppercase;">⚠️ ${rep.report_type}</b><br/>
          <b>Bus:</b> ${rep.bus_reg_no}<br/>
          ${rep.description ? `<b>Details:</b> ${rep.description}<br/>` : ''}
          <b>Time:</b> ${timeStr}
        </div>
      `;

      const m = L.marker([rep.latitude, rep.longitude], { icon: reportIcon })
        .bindPopup(popupContent)
        .addTo(map);

      reportMarkersRef.current.push(m);
    });

  }, [reports]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // ── Calculate navigation details ───────────────────────────────────────────
  let navInstruction = 'Proceed along the route';
  let remainingDist = 0;
  let remainingTime = 0;
  let etaTimeStr = '--:--';
  let nextStop: Stop | undefined;
  let destStop: Stop | undefined;

  if (isNavigationMode && stops && stops.length > 0) {
    nextStop = stops.find(s => s.status !== 'passed');
    destStop = stops[stops.length - 1];

    if (destStop) {
      remainingDist = destStop.distanceRemainingKm || 0;
      remainingTime = destStop.etaMinutes || 0;
      
      const d = new Date(Date.now() + remainingTime * 60000);
      etaTimeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      if (destStop.status === 'arriving_now') {
        navInstruction = `Arriving at your destination: ${destStop.name}`;
      } else if (destStop.status === 'on_stop') {
        navInstruction = `Deboard now at ${destStop.name}!`;
      } else if (nextStop) {
        if (nextStop.status === 'arriving_now' || nextStop.status === 'on_stop') {
          navInstruction = `Arrived at ${nextStop.name}`;
        } else {
          navInstruction = `Next Stop: ${nextStop.name} (${(nextStop.distanceRemainingKm ?? 0).toFixed(1)} km)`;
        }
      }
    }
  }

  const handleRecenter = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([latitude, longitude], 15);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '12px', width: '100%' }}>
      <style>{`
        @keyframes navPulse {
          0% { transform: scale(0.6); opacity: 1; }
          100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', color: '#9ca3af' }}>
          <span>🔴 Live GPS Track {stops && stops.length > 0 && <strong style={{color: '#10b981', marginLeft: '6px'}}>→ To {stops[stops.length-1].name}</strong>}</span>
          <span>ID: {busRegNo}</span>
        </div>
        {routeName && (
          <div style={{ fontSize: '13px', color: '#f3f4f6', fontWeight: 600 }}>
            🗺️ Route: {routeName}
          </div>
        )}
      </div>
      {villages && villages.length > 0 && (
        <div style={{ fontSize: '11px', color: '#ff9f1c', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '7px', height: '7px', background: '#ff9f1c', borderRadius: '50%', display: 'inline-block' }}></span>
          {villages.length} village{villages.length > 1 ? 's' : ''} on this route
        </div>
      )}
      
      <div style={{ position: 'relative', width: '100%' }}>
        <div ref={mapContainerRef} className="map-container" />

        {/* Floating overlays for Navigation Mode */}
        {isNavigationMode && (
          <>
            {/* Top Instruction Banner */}
            <div className="nav-top-banner" style={{
              position: 'absolute',
              top: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 1000,
              width: '90%',
              maxWidth: '380px',
              backgroundColor: '#ffffff',
              borderRadius: '30px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
              padding: '10px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              border: '1px solid rgba(0,0,0,0.05)',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: '#007aff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: '#ffffff'
              }}>
                <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '18px', height: '18px' }}>
                  <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
                </svg>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '800', color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {navInstruction}
                </div>
                {nextStop && (nextStop.distanceRemainingKm ?? 0) > 0 && (
                  <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '1px' }}>
                    Heading towards destination stop
                  </div>
                )}
              </div>
            </div>

            {/* Bottom Navigation Dashboard */}
            <div className="nav-bottom-dashboard" style={{
              position: 'absolute',
              bottom: '16px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 1000,
              width: '90%',
              maxWidth: '400px',
              backgroundColor: '#ffffff',
              borderRadius: '24px',
              boxShadow: '0 8px 35px rgba(0,0,0,0.25)',
              padding: '14px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              border: '1px solid rgba(0,0,0,0.05)'
            }}>
              <div style={{
                width: '36px',
                height: '4px',
                backgroundColor: '#e5e7eb',
                borderRadius: '2px',
                margin: '0 auto -2px auto'
              }}></div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '4px'
              }}>
                {/* Left: Close Button + Speedometer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={onCloseNavigation}
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      border: '1px solid #e5e7eb',
                      backgroundColor: '#ffffff',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#374151',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                      padding: 0
                    }}
                    title="Exit Navigation"
                  >
                    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ width: '16px', height: '16px' }}>
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      border: '3px solid #dc2626',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: '900',
                      color: '#111827',
                      backgroundColor: '#ffffff'
                    }}>
                      80
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#111827', lineHeight: 1.1 }}>
                        {Math.round(currentSpeedKmph ?? 0)}
                      </span>
                      <span style={{ fontSize: '8px', color: '#6b7280' }}>
                        km/h
                      </span>
                    </div>
                  </div>
                </div>

                {/* Center: ETA & Time Remaining */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                  <span style={{ fontSize: '20px', fontWeight: '800', color: '#ea580c', lineHeight: 1.1 }}>
                    {remainingTime} min
                  </span>
                  <span style={{ fontSize: '11px', color: '#4b5563', fontWeight: '600', marginTop: '2px' }}>
                    {remainingDist.toFixed(1)} km • {etaTimeStr}
                  </span>
                </div>

                {/* Right: Recenter Button */}
                <button
                  onClick={handleRecenter}
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    border: 'none',
                    backgroundColor: '#f3f4f6',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#111827',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                    padding: 0
                  }}
                  title="Recenter Map"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: '16px', height: '16px' }}>
                    <path d="M12 2v3m0 14v3M2 12h3m14 0h3M12 8a4 4 0 100 8 4 4 0 000-8z"/>
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
