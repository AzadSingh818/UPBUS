'use client';

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

interface ActiveBusState {
  busId?: number;
  regNo: string;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  lastSeen: string;
  routeCode?: string;
  routeName?: string;
  currentStop?: string;
  status: string;
}

interface LiveMapProps {
  buses: ActiveBusState[];
  refreshTrigger?: number;
}

export default function LiveMap({ buses, refreshTrigger = 0 }: LiveMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const busMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  
  const [mapData, setMapData] = useState<{ stops: any[]; routes: any[] } | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch static route network and stops when mounted or when refreshed manually
  useEffect(() => {
    async function fetchMapData() {
      try {
        setLoading(true);
        const ts = Date.now();
        const res = await fetch(`/api/v1/admin/monitor/map-data?t=${ts}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setMapData(data);
        }
      } catch (err) {
        console.error('[Live Map] Error loading map-data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchMapData();
  }, [refreshTrigger]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current || loading) return;

    // Clear any previous leaflet instances or DOM residue from the container
    const container = mapContainerRef.current;
    if (container) {
      container.innerHTML = '';
      delete (container as any)._leaflet_id;
    }

    // Create Leaflet map instance centered on Lucknow (UP center)
    const map = L.map(container, {
      center: [26.8467, 80.9462],
      zoom: 7,
      maxZoom: 15,
      minZoom: 6,
    });

    mapInstanceRef.current = map;

    // Add Dark Mode CartoDB Map Tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    // Render static routes if available
    if (mapData) {
      const polylines: { polyline: L.Polyline; routeName: string }[] = [];

      // Helper function to build tooltip content
      const getTooltipContent = (name: string) => `
        <div style="
          color: #e2e8f0;
          font-weight: 600;
          font-family: sans-serif;
          font-size: 11px;
          padding: 4px 8px;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 6px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          backdrop-filter: blur(4px);
          white-space: nowrap;
        ">
          ${name}
        </div>
      `;

      // Draw Route lines
      mapData.routes.forEach((route) => {
        const polyline = L.polyline(route.path, {
          color: '#f59e0b',
          weight: 2.5,
          opacity: 0.4,
          lineJoin: 'round'
        });

        // Set initial tooltip configuration (always hover-only, non-permanent)
        polyline.bindTooltip(getTooltipContent(route.routeName), {
          permanent: false,
          sticky: true,
          direction: 'auto',
          opacity: 0.9,
          className: 'custom-route-tooltip'
        });

        // Hover events to highlight the route path
        polyline.on('mouseover', () => {
          polyline.setStyle({
            color: '#10b981', // glowing green on hover
            weight: 5,
            opacity: 0.9
          });
        });

        polyline.on('mouseout', () => {
          polyline.setStyle({
            color: '#f59e0b',
            weight: 2.5,
            opacity: 0.4
          });
        });

        polyline.addTo(map);
        polylines.push({ polyline, routeName: route.routeName });
      });


    }

    // Cleanup on unmount
    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.off(); // Remove all event listeners first
          mapInstanceRef.current.remove();
        } catch (err) {
          console.warn('[Live Map] Error during map removal:', err);
        }
        mapInstanceRef.current = null;
        busMarkersRef.current.clear();
      }
    };
  }, [loading, mapData]);

  // Bus Markers intentionally removed per user request.

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {loading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: '#05070c',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9ca3af',
          zIndex: 1000,
          fontFamily: 'sans-serif',
          gap: '12px'
        }}>
          <div style={{
            width: '30px',
            height: '30px',
            border: '3px solid #1e293b',
            borderTopColor: '#f59e0b',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }}></div>
          <span>Loading UP Roadways Network Map...</span>
          <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
        </div>
      )}
      <div 
        ref={mapContainerRef} 
        style={{ width: '100%', height: '100%', borderRadius: '12px', background: '#05070c' }} 
      />
    </div>
  );
}
