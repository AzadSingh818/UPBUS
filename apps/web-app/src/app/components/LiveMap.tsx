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
}

export interface Village {
  name: string;
  latitude: number;
  longitude: number;
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
}

/** Zoom level at which village labels become visible. */
const VILLAGE_ZOOM_THRESHOLD = 13;

export default function LiveMap({
  latitude, longitude, stops, busRegNo, heading,
  villages,
  multipleRoutes, onSelectRoute,
}: LiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const busMarkerRef = useRef<any>(null);
  const passedPolylineRef = useRef<any>(null);
  const upcomingPolylineRef = useRef<any>(null);
  const stopMarkersRef = useRef<any[]>([]);
  const villageMarkersRef = useRef<any[]>([]);

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

    setTimeout(() => { map.invalidateSize(); }, 100);

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
          route.stops.forEach(stop => {
            if (stop.latitude === undefined || stop.longitude === undefined) return;

            const isVillage = stop.name.toLowerCase().includes('village');
            const stopIcon = L.divIcon({
              className: 'stop-dot-icon',
              html: `<div style="
                width: 12px; height: 12px;
                background-color: ${isVillage ? 'var(--accent)' : 'white'};
                border: 3px solid ${route.color || '#3b82f6'};
                border-radius: 50%;
                box-shadow: 0 1px 4px rgba(0,0,0,0.3);
              "></div>`,
              iconSize: [12, 12],
              iconAnchor: [6, 6]
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
      }

      if (passedLatLngs.length > 0) {
        if (!passedPolylineRef.current) {
          passedPolylineRef.current = L.polyline(passedLatLngs, { color: '#6b7280', weight: 4, opacity: 0.6 }).addTo(map);
        } else {
          passedPolylineRef.current.setLatLngs(passedLatLngs);
        }
      }

      if (upcomingLatLngs.length > 0) {
        if (!upcomingPolylineRef.current) {
          upcomingPolylineRef.current = L.polyline(upcomingLatLngs, { color: '#10b981', weight: 5, opacity: 0.9, dashArray: '10, 10' }).addTo(map);
        } else {
          upcomingPolylineRef.current.setLatLngs(upcomingLatLngs);
        }
      }

      stops.forEach(stop => {
        if (stop.latitude === undefined || stop.longitude === undefined) return;

        const isPassed  = stop.status === 'passed';
        const isCurrent = stop.status === 'arriving_now' || stop.status === 'arriving_soon';
        const isOnStop  = stop.status === 'on_stop';

        const stopIcon = L.divIcon({
          className: 'stop-dot-icon',
          html: `<div style="
            width: 12px; height: 12px;
            background-color: ${isOnStop ? '#10b981' : isCurrent ? '#ff9f1c' : isPassed ? '#4f46e5' : '#6b7280'};
            border: 2px solid #ffffff;
            border-radius: 50%;
            box-shadow: 0 0 8px ${isOnStop ? '#10b981' : isCurrent ? '#ff9f1c' : 'transparent'};
          "></div>`,
          iconSize: [12, 12],
          iconAnchor: [6, 6]
        });

        const stopMarker = L.marker([stop.latitude, stop.longitude], { icon: stopIcon })
          .addTo(map)
          .bindPopup(`<b>${stop.name}</b><br/>Sequence: ${stop.sequenceNo}<br/>Status: ${stop.status.replace('_', ' ')}`);

        stopMarkersRef.current.push(stopMarker);
      });
    }

    // 3. Bus marker with direction arrow
    const busIcon = L.divIcon({
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

    if (busMarkerRef.current) {
      busMarkerRef.current.setLatLng([latitude, longitude]);
      busMarkerRef.current.setIcon(busIcon);
    } else {
      busMarkerRef.current = L.marker([latitude, longitude], { icon: busIcon })
        .addTo(map)
        .bindPopup(`<b>Bus: ${busRegNo}</b><br/>Status: Active & Tracking`);
    }

    map.panTo([latitude, longitude]);

  }, [latitude, longitude, stops, busRegNo, heading, multipleRoutes, onSelectRoute]);

  // ── Village markers (zoom-gated) ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !mapInstanceRef.current) return;

    const L = require('leaflet');
    const map = mapInstanceRef.current;

    // Remove old village markers
    villageMarkersRef.current.forEach(m => m.remove());
    villageMarkersRef.current = [];

    if (!villages || villages.length === 0) return;

    /** Create a village divIcon with a permanent inline label. */
    const makeVillageIcon = (name: string) => L.divIcon({
      className: 'village-marker-icon',
      html: `
        <div class="village-marker-wrapper">
          <div class="village-dot"></div>
          <span class="village-label">${name}</span>
        </div>
      `,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

    /** Show/hide all village markers based on current zoom. */
    const updateVisibility = () => {
      const zoom = map.getZoom();
      const show = zoom >= VILLAGE_ZOOM_THRESHOLD;
      for (const m of villageMarkersRef.current) {
        const el = m.getElement();
        if (el) {
          el.style.display = show ? '' : 'none';
        }
      }
    };

    // Add markers (hidden initially if zoom < threshold)
    for (const v of villages) {
      const icon = makeVillageIcon(v.name);
      const marker = L.marker([v.latitude, v.longitude], {
        icon,
        interactive: false, // villages are reference labels, not interactive
        zIndexOffset: -100,  // render below stop markers
      }).addTo(map);
      villageMarkersRef.current.push(marker);
    }

    updateVisibility();
    map.on('zoomend', updateVisibility);

    return () => {
      map.off('zoomend', updateVisibility);
    };
  }, [villages]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="glass-panel" style={{ padding: '12px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: '#9ca3af' }}>
        <span>🔴 Live GPS Track {stops && stops.length > 0 && <strong style={{color: '#10b981', marginLeft: '6px'}}>→ To {stops[stops.length-1].name}</strong>}</span>
        <span>ID: {busRegNo}</span>
      </div>
      <div ref={mapContainerRef} className="map-container" />
    </div>
  );
}
