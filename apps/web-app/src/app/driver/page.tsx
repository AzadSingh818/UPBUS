'use client';

import { useState, useEffect, useRef } from 'react';
import { Bus, MapPin, Zap, AlertCircle } from 'lucide-react';

let API_BASE = '/api/v1';
if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  API_BASE = 'http://localhost:5000/api/v1';
} else if (typeof window !== 'undefined') {
  // Production fallback
  API_BASE = 'http://51.20.190.81:5000/api/v1';
}

export default function DriverApp() {
  const [busRegNo, setBusRegNo] = useState('');
  const [routeCode, setRouteCode] = useState('');
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState('');
  const [location, setLocation] = useState<{lat: number, lng: number, speed: number, heading: number} | null>(null);

  const watchIdRef = useRef<number | null>(null);

  const handleStart = () => {
    if (!busRegNo.trim()) {
      setError('Please enter a valid Bus Registration Number');
      return;
    }
    setError('');

    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setIsTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const speedMpS = pos.coords.speed || 0; // meters per second
        const speedKmph = speedMpS * 3.6; // convert to km/h
        const heading = pos.coords.heading || 0;

        setLocation({ lat, lng, speed: speedKmph, heading });

        // Send to backend
        try {
          await fetch(`${API_BASE}/driver/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              busRegNo,
              routeCode,
              latitude: lat,
              longitude: lng,
              speed: speedKmph,
              heading
            })
          });
        } catch (err) {
          console.error('Failed to ping location', err);
        }
      },
      (err) => {
        console.error(err);
        setError(`GPS Error: ${err.message}`);
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
      }
    );
  };

  const handleStop = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    setLocation(null);
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  return (
    <div style={{ padding: '20px', maxWidth: '500px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <Bus size={48} color="#0056b3" style={{ margin: '0 auto' }} />
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '10px 0' }}>UPBus Driver App</h1>
        <p style={{ color: '#666' }}>Broadcast your live location to passengers</p>
      </div>

      {error && (
        <div style={{ backgroundColor: '#ffebee', color: '#c62828', padding: '10px', borderRadius: '8px', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {!isTracking ? (
        <div style={{ backgroundColor: '#f9f9f9', padding: '20px', borderRadius: '12px', border: '1px solid #ddd' }}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Bus Registration No *</label>
            <input 
              type="text" 
              placeholder="e.g. UP32BG1234"
              value={busRegNo}
              onChange={(e) => setBusRegNo(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '16px' }}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Route Code (Optional)</label>
            <input 
              type="text" 
              placeholder="e.g. R_LKO_KAN"
              value={routeCode}
              onChange={(e) => setRouteCode(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc', fontSize: '16px' }}
            />
          </div>
          <button 
            onClick={handleStart}
            style={{ width: '100%', padding: '14px', backgroundColor: '#0056b3', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Start Trip
          </button>
        </div>
      ) : (
        <div style={{ backgroundColor: '#e8f5e9', padding: '20px', borderRadius: '12px', border: '1px solid #c8e6c9', textAlign: 'center' }}>
          <h2 style={{ color: '#2e7d32', margin: '0 0 15px 0' }}>🟢 Broadcasting Live</h2>
          <p style={{ fontWeight: 'bold', fontSize: '18px' }}>{busRegNo}</p>
          
          <div style={{ margin: '20px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#555' }}>
              <MapPin size={18} />
              <span>{location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : 'Acquiring GPS...'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: '#555' }}>
              <Zap size={18} />
              <span>Speed: {location ? `${location.speed.toFixed(1)} km/h` : '--'}</span>
            </div>
          </div>

          <button 
            onClick={handleStop}
            style={{ width: '100%', padding: '14px', backgroundColor: '#c62828', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}
          >
            Stop Trip
          </button>
        </div>
      )}
    </div>
  );
}
