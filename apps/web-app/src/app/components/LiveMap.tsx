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

      // Standard OpenStreetMap tiles (100% free, no API key required, reliable worldwide)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        subdomains: ['a', 'b', 'c'],
        maxZoom: 19
      }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;

    const resizeTimer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 100);
    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 400);

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

      // If active bus coordinates are also available, include them so the bus marker is clearly framed!
      if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude) && (Number(latitude) !== 0 || Number(longitude) !== 0)) {
        allLatLngs.push([Number(latitude), Number(longitude)]);
      }

      if (allLatLngs.length > 0) {
        map.fitBounds(allLatLngs as any, { padding: [60, 60], maxZoom: 14 });
      }
    } else if (stops && stops.length > 0) {
      let lastPassedIndex = -1;
      for (let i = 0; i < stops.length; i++) {
        if (stops[i].status === 'passed') lastPassedIndex = i;
      }

      const validStops = stops.filter(s => s.latitude !== undefined && s.longitude !== undefined);
      const passedLatLngs: any[] = [];
      const upcomingLatLngs: any[] = [];
      const hasValidBusCoords = latitude && longitude && !isNaN(latitude) && !isNaN(longitude) && (Number(latitude) !== 0 || Number(longitude) !== 0);
      const busLatLng = [Number(latitude), Number(longitude)];

      if (validStops.length > 0) {
        // Find the nearest stop index to the current bus position
        let nearestStopIndex = -1;
        let minBusDist = Infinity;
        if (hasValidBusCoords) {
          validStops.forEach((s, idx) => {
            const d = Math.hypot(Number(s.latitude) - Number(latitude), Number(s.longitude) - Number(longitude));
            if (d < minBusDist) {
              minBusDist = d;
              nearestStopIndex = idx;
            }
          });
        }

        // Only insert busLatLng into route polyline if bus is within realistic proximity to the immediate segment stops (< 5km)
        // AND check if the bus has taken a route turn / diversion away from the corridor
        let isBusDiverted = false;
        let busDistToSegment = Infinity;

        if (hasValidBusCoords) {
          const prevStop = lastPassedIndex >= 0 ? validStops[lastPassedIndex] : null;
          const nextStop = lastPassedIndex < validStops.length - 1 ? validStops[lastPassedIndex + 1] : null;

          if (prevStop && nextStop) {
            const dPrev = Math.hypot(Number(prevStop.latitude) - Number(latitude), Number(prevStop.longitude) - Number(longitude)) * 111;
            const dNext = Math.hypot(Number(nextStop.latitude) - Number(latitude), Number(nextStop.longitude) - Number(longitude)) * 111;
            busDistToSegment = Math.min(dPrev, dNext);
            if (busDistToSegment > 6.0) {
              isBusDiverted = true;
            }
          }
        }

        const isBusNearCorridor = hasValidBusCoords && !isBusDiverted && busDistToSegment < 6.0;

        validStops.forEach((s, i) => {
          const ll = [Number(s.latitude), Number(s.longitude)];
          if (i <= lastPassedIndex) passedLatLngs.push(ll);
          if (i >= lastPassedIndex) upcomingLatLngs.push(ll);
        });

        if (hasValidBusCoords && isBusNearCorridor) {
          if (lastPassedIndex >= 0 && lastPassedIndex < validStops.length - 1) {
            passedLatLngs.push(busLatLng);
            upcomingLatLngs.unshift(busLatLng);
          } else if (lastPassedIndex === -1) {
            upcomingLatLngs.unshift(busLatLng);
          } else if (lastPassedIndex === validStops.length - 1) {
            passedLatLngs.push(busLatLng);
          }
        }

        if (passedPolylineRef.current) passedPolylineRef.current.remove();
        if (upcomingPolylineRef.current) upcomingPolylineRef.current.remove();

        // 1. Passed route path is emerald green (#10b981) to match timeline
        passedPolylineRef.current = L.polyline(passedLatLngs, { 
          color: '#10b981', 
          weight: 6, 
          opacity: 0.85, 
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(map);

        // 2. Upcoming route path is bright royal blue / indigo
        if (isNavigationMode) {
          upcomingPolylineRef.current = L.polyline(upcomingLatLngs, {
            color: '#3b82f6',
            weight: 6,
            opacity: 0.95,
            lineJoin: 'round',
            lineCap: 'round'
          }).addTo(map);
        } else {
          upcomingPolylineRef.current = L.polyline(upcomingLatLngs, {
            color: '#6366f1',
            weight: 5,
            opacity: 0.9,
            lineJoin: 'round',
            lineCap: 'round'
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
    if (!busRegNo) {
      if (busMarkerRef.current) {
        busMarkerRef.current.remove();
        busMarkerRef.current = null;
      }
    } else {
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
            <div class="bus-marker-wrapper" style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
              <div class="bus-pulse-ring" style="
                position: absolute;
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: rgba(16, 185, 129, 0.4);
                animation: busPulse 1.8s infinite ease-out;
              "></div>
              <div class="bus-badge-label" style="
                position: absolute;
                top: -26px;
                white-space: nowrap;
                background: #090d16;
                color: #38bdf8;
                font-size: 11px;
                font-weight: 800;
                padding: 3px 8px;
                border-radius: 12px;
                border: 1.5px solid #0284c7;
                box-shadow: 0 3px 10px rgba(0,0,0,0.6);
                letter-spacing: 0.4px;
                pointer-events: none;
                display: flex;
                align-items: center;
                gap: 4px;
              ">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981; animation: pulse 1s infinite;"></span>
                ${busRegNo}
              </div>
              <div class="bus-direction-container" style="
                width: 38px;
                height: 38px;
                background: #020617;
                border: 2.5px solid #10b981;
                border-radius: 50%;
                box-shadow: 0 4px 14px rgba(0,0,0,0.7), 0 0 12px rgba(16, 185, 129, 0.6);
                display: flex;
                align-items: center;
                justify-content: center;
                color: #ffffff;
                position: relative;
                transform: rotate(${heading || 0}deg);
                transition: transform 0.4s ease-out;
              ">
                <!-- Direction Pointer Arrow -->
                <div style="
                  position: absolute;
                  top: -7px;
                  left: 50%;
                  transform: translateX(-50%);
                  width: 0;
                  height: 0;
                  border-left: 6px solid transparent;
                  border-right: 6px solid transparent;
                  border-bottom: 8px solid #10b981;
                "></div>

                <svg viewBox="0 0 24 24" fill="#38bdf8" style="width: 22px; height: 22px; transform: rotate(-${heading || 0}deg);">
                  <path d="M18 11.03V7.05c0-2.22-3.23-2.92-6-2.92s-6 .7-6 2.92v3.98c-1.2.35-2 1.34-2 2.53v5.47c0 .83.67 1.5 1.5 1.5h.5v1c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-1h7v1c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-1h.5c.83 0 1.5-.67 1.5-1.5v-5.47c0-1.19-.8-2.18-2-2.53zM7.5 16c-.83 0-1.5-.67-1.5-1.5S6.67 13 7.5 13s1.5.67 1.5 1.5S8.33 16 7.5 16zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V7h12v3z"/>
                </svg>
              </div>
            </div>
          `,
          iconSize: [48, 48],
          iconAnchor: [24, 24]
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
        busMarkerRef.current.setZIndexOffset(3000);
      } else {
        busMarkerRef.current = L.marker([latitude, longitude], { icon: selectedIcon, zIndexOffset: 3000 })
          .addTo(map)
          .bindPopup(popupContent);
      }
    }

    if (isNavigationMode) {
      map.setView([latitude, longitude], 15);
    } else if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude) && busRegNo) {
      map.setView([latitude, longitude], Math.max(map.getZoom(), 13), { animate: true });
    }

    return () => {
      clearTimeout(resizeTimer);
    };
  }, [latitude, longitude, stops, busRegNo, heading, multipleRoutes, onSelectRoute, currentSpeedKmph]);

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
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%' }}>
      <div ref={mapContainerRef} className="map-container" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 }} />

      {/* Sleek Floating Status Badge on Map */}
      <div style={{
        position: 'absolute',
        top: '12px',
        right: '12px',
        zIndex: 1000,
        background: 'rgba(10, 15, 30, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '12px',
        color: '#f3f4f6',
        boxShadow: '0 4px 15px rgba(0,0,0,0.4)',
        pointerEvents: 'none'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', background: '#10b981', borderRadius: '50%', boxShadow: '0 0 8px #10b981' }}></span>
          <span style={{ fontWeight: 600 }}>{busRegNo ? `Bus ${busRegNo}` : 'Live Route Track'}</span>
        </div>
        {villages && villages.length > 0 && (
          <span style={{ color: '#ff9f1c', borderLeft: '1px solid rgba(255,255,255,0.15)', paddingLeft: '8px', fontWeight: 600 }}>
            📍 {villages.length} Villages
          </span>
        )}
      </div>

      {/* Floating overlays for Navigation Mode */}
      {isNavigationMode && (
        <>
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
              {onCloseNavigation && (
                <button
                  onClick={onCloseNavigation}
                  style={{
                    border: 'none',
                    background: '#f1f5f9',
                    borderRadius: '50%',
                    width: '28px',
                    height: '28px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#64748b'
                  }}
                  title="Close Navigation HUD"
                >
                  <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" style={{ width: '14px', height: '14px' }}>
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              )}
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
    );
}
