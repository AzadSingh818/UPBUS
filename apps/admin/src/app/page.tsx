'use client';

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { 
  Bus, 
  Terminal as TerminalIcon, 
  Settings, 
  Activity, 
  Database, 
  MapPin, 
  Compass, 
  RefreshCw, 
  Navigation,
  ArrowLeft
} from 'lucide-react';

const LiveMap = dynamic(() => import('../components/LiveMap'), { ssr: false });

interface AdminLogItem {
  timestamp: string;
  type: 'VALIDATION' | 'SEEDER' | 'LEARNING' | 'ERROR' | 'SYSTEM' | 'NEW_BUS';
  busId?: string | number;
  regNo?: string;
  status?: 'duplicate' | 'accepted' | 'rejected' | 'success' | 'failed';
  message: string;
}

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
  zoneName?: string;
  status: string;
  isNewlyDetected?: boolean;
}

interface DatabaseStats {
  stopsCount: number;
  routesCount: number;
  routeStopsCount: number;
  busesCount: number;
  tripsCount: number;
  learnedRoutesCount: number;
  activeBusesCount: number;
}

export default function AdminMonitor() {
  const [logs, setLogs] = useState<AdminLogItem[]>([]);
  const [buses, setBuses] = useState<ActiveBusState[]>([]);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [isLive, setIsLive] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isMounted, setIsMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const [viewMode, setViewMode] = useState<'console' | 'map' | 'coverage'>('coverage');
  const [speedFilter, setSpeedFilter] = useState<'all' | 'moving' | 'halted'>('all');

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Reset page to 1 when search query or speed filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, speedFilter]);

  const filteredBuses = buses.filter(bus => {
    const isMoving = (bus.speed ?? 0) >= 5;
    // 1. Filter by speed status
    if (speedFilter === 'moving' && !isMoving) return false;
    if (speedFilter === 'halted' && isMoving) return false;

    // 2. Filter by search query
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (bus.regNo || '').toLowerCase().includes(q) ||
      (bus.routeName || '').toLowerCase().includes(q) ||
      (bus.originalRouteStr || '').toLowerCase().includes(q) ||
      (bus.currentStop || '').toLowerCase().includes(q) ||
      (bus.zoneName || '').toLowerCase().includes(q)
    );
  });

  const movingBusesCount = buses.filter(b => (b.speed ?? 0) >= 5).length;
  const haltedBusesCount = buses.filter(b => (b.speed ?? 0) < 5).length;

  const totalPages = Math.ceil(filteredBuses.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedBuses = filteredBuses.slice(startIndex, startIndex + itemsPerPage);

  const TARGET_ROUTES = 5047;
  const currentRoutes = stats?.routesCount || 0;
  const coveragePercent = Math.min(100, (currentRoutes / TARGET_ROUTES) * 100).toFixed(1);
  const donutRadius = 55;
  const donutCircumference = 2 * Math.PI * donutRadius;
  const donutStrokeDasharray = `${(parseFloat(coveragePercent) / 100) * donutCircumference} ${donutCircumference}`;

  useEffect(() => {
    setIsMounted(true);
  }, []);
  const API_BASE = '/api/v1/admin';

  // Fetch all administrative data
  const fetchData = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const ts = Date.now();
      // 1. Logs
      const logsRes = await fetch(`${API_BASE}/monitor/logs?t=${ts}`, { cache: 'no-store' });
      const logsData = await logsRes.json();
      setLogs(logsData.logs || []);

      // 2. Active Buses
      const busesRes = await fetch(`${API_BASE}/monitor/buses?t=${ts}`, { cache: 'no-store' });
      const busesData = await busesRes.json();
      setBuses(busesData.buses || []);

      // 3. Stats
      const statsRes = await fetch(`${API_BASE}/monitor/stats?t=${ts}`, { cache: 'no-store' });
      const statsData = await statsRes.json();
      setStats(statsData.stats || null);

      setLastRefreshed(new Date());
      if (isManual) setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      console.error('[Admin Console] Error polling admin data:', err);
    } finally {
      if (isManual) {
        setTimeout(() => setIsRefreshing(false), 500); // minimum visual feedback
      }
    }
  };

  // Setup polling intervals
  useEffect(() => {
    fetchData(); // Initial load

    if (!isLive) return;

    const interval = setInterval(() => {
      fetchData();
    }, 2000); // 2-second update cycles

    return () => clearInterval(interval);
  }, [isLive]);

  // Scroll to bottom of terminal when logs change
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  const getLogTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'VALIDATION': return 'badge-validation';
      case 'SEEDER': return 'badge-seeder';
      case 'LEARNING': return 'badge-learning';
      case 'ERROR': return 'badge-error';
      case 'NEW_BUS': return 'badge-new-bus';
      default: return 'badge-system';
    }
  };

  const getLogStatusClass = (status?: string) => {
    switch (status) {
      case 'duplicate': return 'status-dup';
      case 'accepted': return 'status-accept';
      case 'success': return 'status-success';
      case 'failed': return 'status-fail';
      default: return '';
    }
  };

  return (
    <div className="admin-dashboard-container">
      {/* CSS Rules specifically for Admin Page to keep it decoupled and modular */}
      <style>{`
        .admin-dashboard-container {
          min-height: 100vh;
          background-color: #0b0f19;
          color: #f3f4f6;
          font-family: 'Inter', -apple-system, sans-serif;
          padding: 24px;
        }

        .admin-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          padding-bottom: 16px;
        }

        .admin-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .admin-title h1 {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.5px;
          margin: 0;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .admin-actions {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .live-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 6px 12px;
          border-radius: 20px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }

        .status-dot.active {
          background-color: #10b981;
          box-shadow: 0 0 8px #10b981;
          animation: pulse-dot 1.5s infinite;
        }

        .status-dot.paused {
          background-color: #ef4444;
        }

        @keyframes pulse-dot {
          0% { opacity: 0.4; }
          50% { opacity: 1; }
          100% { opacity: 0.4; }
        }

        /* Coverage Tracker */
        .coverage-container {
          background: rgba(17, 24, 39, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 24px 32px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 40px;
        }

        .coverage-left {
          flex: 1;
        }

        .coverage-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .coverage-title {
          font-size: 14px;
          font-weight: 600;
          color: #f3f4f6;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .coverage-stats {
          font-size: 13px;
          color: #9ca3af;
        }

        .progress-track {
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
          width: 100%;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #10b981 0%, #34d399 100%);
          transition: width 1s ease-in-out;
        }
        
        .coverage-right {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        
        .donut-container {
          position: relative;
          width: 140px;
          height: 140px;
        }
        
        .donut-hole-text {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: 700;
          color: #f3f4f6;
        }
        
        .donut-legend {
          display: flex;
          gap: 16px;
          font-size: 12px;
          color: #9ca3af;
        }
        
        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        /* Stats Cards */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }

        .stat-card {
          background: rgba(17, 24, 39, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          transition: transform 0.2s ease;
        }

        .stat-card:hover {
          transform: translateY(-2px);
          border-color: rgba(245, 158, 11, 0.3);
        }

        .stat-icon-box {
          width: 44px;
          height: 44px;
          background: rgba(245, 158, 11, 0.1);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #f59e0b;
        }

        .stat-info {
          display: flex;
          flex-direction: column;
        }

        .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: #ffffff;
        }

        .stat-label {
          font-size: 11px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 2px;
        }

        /* Split Workspace Layout */
        .admin-workspace {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 20px;
        }

        @media (max-width: 1024px) {
          .admin-workspace {
            grid-template-columns: 1fr;
          }
        }

        /* Terminal Window */
        .console-panel {
          background: #05070c;
          border: 1px solid #1f2937;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          height: 520px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          overflow: hidden;
        }

        .console-header {
          background: #0f172a;
          padding: 10px 16px;
          border-bottom: 1px solid #1e293b;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .console-window-dots {
          display: flex;
          gap: 6px;
        }

        .win-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }

        .win-dot.red { background-color: #ef4444; }
        .win-dot.yellow { background-color: #f59e0b; }
        .win-dot.green { background-color: #10b981; }

        .console-title {
          font-family: monospace;
          font-size: 12px;
          color: #64748b;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .console-terminal {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
          font-family: monospace;
          font-size: 12.5px;
          line-height: 1.6;
          display: flex;
          flex-direction: column;
          gap: 6px;
          background-color: #030508;
        }

        .log-line {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          word-break: break-all;
        }

        .log-time {
          color: #475569;
          user-select: none;
          flex-shrink: 0;
        }

        .log-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          flex-shrink: 0;
        }

        .badge-validation { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
        .badge-seeder { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168,85,247,0.3); }
        .badge-learning { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); }
        .badge-error { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); }
        .badge-new-bus { background: rgba(6, 182, 212, 0.15); color: #22d3ee; border: 1px solid rgba(6,182,212,0.3); }
        .badge-system { background: rgba(107, 114, 128, 0.15); color: #9ca3af; border: 1px solid rgba(107,114,128,0.3); }

        .new-bus-tag {
          font-size: 9px;
          font-weight: 800;
          background: #22d3ee;
          color: #0b0f19;
          padding: 1px 4px;
          border-radius: 4px;
          margin-left: 6px;
          vertical-align: middle;
          animation: flash-tag 1s infinite alternate;
        }

        @keyframes flash-tag {
          from { opacity: 0.6; }
          to { opacity: 1; }
        }

        .log-msg {
          color: #34d399; /* Console green */
        }

        .status-dup { color: #94a3b8; opacity: 0.85; }
        .status-accept { color: #34d399; font-weight: 600; }
        .status-success { color: #f59e0b; font-weight: 600; }
        .status-fail { color: #ef4444; }

        /* Buses Grid */
        .buses-panel {
          background: rgba(17, 24, 39, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          height: 520px;
          overflow: hidden;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 12px;
        }

        .panel-title {
          font-size: 15px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .bus-count-badge {
          background: #f59e0b;
          color: #0b0f19;
          font-size: 11px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 12px;
        }

        .buses-table-wrapper {
          flex: 1;
          overflow-y: auto;
        }

        .buses-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }

        .buses-table th {
          font-size: 11px;
          font-weight: 600;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 10px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(0, 0, 0, 0.2);
          position: sticky;
          top: 0;
          z-index: 2;
        }

        .buses-table td {
          padding: 12px;
          font-size: 13px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .buses-table tr:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .bus-badge-reg {
          font-family: monospace;
          background: rgba(245, 158, 11, 0.1);
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.25);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
        }

        .text-truncate {
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .status-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 12px;
          text-transform: uppercase;
          display: inline-block;
        }

        .status-badge.at-stop { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .status-badge.between-stops { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
        .status-badge.reversing { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
        .status-badge.completed { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
        .status-badge.moving { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .status-badge.halted { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

        .btn-live-toggle {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #f3f4f6;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .btn-live-toggle:hover {
          background: rgba(255, 255, 255, 0.08);
        }

        .back-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: #9ca3af;
          font-size: 13px;
          text-decoration: none;
          transition: color 0.2s;
        }

        .back-link:hover {
          color: #f59e0b;
        }

        .search-container {
          padding: 0 16px 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          margin-bottom: 12px;
        }

        .search-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #ffffff;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 13px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
        }

        .search-input:focus {
          border-color: #f59e0b;
          box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15);
        }

        .pagination-container {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: rgba(10, 15, 26, 0.9);
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          font-size: 12px;
          color: #9ca3af;
        }

        .pagination-btn {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #f3f4f6;
          padding: 5px 12px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: all 0.2s;
        }

        .pagination-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.15);
        }

        .pagination-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        /* Custom Leaflet Tooltip styles */
        .custom-route-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .custom-route-tooltip::before {
          display: none !important;
        }
      `}</style>

      {/* Header section */}
      <div className="admin-header">
        <div className="admin-title">
          <a href="http://localhost:3001" className="back-link">
            <ArrowLeft size={16} /> Public Site
          </a>
          <span style={{color: '#4b5563'}}>|</span>
          <Bus size={22} style={{color: '#f59e0b'}} />
          <h1>UPBus Live Admin Console</h1>
        </div>
        <div className="admin-actions" style={{ gap: '12px' }}>
          {/* Console / Map View Toggle Buttons */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '3px', border: '1px solid rgba(255,255,255,0.08)', marginRight: '8px' }}>
            <button 
              style={{
                padding: '6px 14px',
                fontSize: '12.5px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'console' ? '#f59e0b' : 'transparent',
                color: viewMode === 'console' ? '#0b0f19' : '#f3f4f6',
                fontWeight: 600,
                transition: 'all 0.2s',
                outline: 'none'
              }}
              onClick={() => setViewMode('console')}
            >
              Console View
            </button>
            <button 
              style={{
                padding: '6px 14px',
                fontSize: '12.5px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'map' ? '#f59e0b' : 'transparent',
                color: viewMode === 'map' ? '#0b0f19' : '#f3f4f6',
                fontWeight: 600,
                transition: 'all 0.2s',
                outline: 'none'
              }}
              onClick={() => setViewMode('map')}
            >
              Map View
            </button>
            <button 
              style={{
                padding: '6px 14px',
                fontSize: '12.5px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'coverage' ? '#f59e0b' : 'transparent',
                color: viewMode === 'coverage' ? '#0b0f19' : '#f3f4f6',
                fontWeight: 600,
                transition: 'all 0.2s',
                outline: 'none'
              }}
              onClick={() => setViewMode('coverage')}
            >
              Coverage
            </button>
          </div>
          
          <span style={{ color: '#374151' }}>|</span>

          <span style={{ fontSize: '12px', color: '#6b7280' }}>
            Refreshed: {isMounted ? formatTime(lastRefreshed.toISOString()) : ''}
          </span>
          <button
            className="btn-live-toggle"
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            title="Manually refresh data now"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: isRefreshing ? 0.7 : 1 }}
          >
            <RefreshCw 
              size={13} 
              className={isRefreshing ? 'animate-spin' : ''}
            />
            {isRefreshing ? 'Refreshing...' : 'Refresh Now'}
          </button>
          <button className="btn-live-toggle" onClick={() => setIsLive(!isLive)}>
            {isLive ? 'Pause Polling' : 'Resume Polling'}
          </button>
          <div className="live-indicator">
            <span className={`status-dot ${isLive ? 'active' : 'paused'}`}></span>
            <span>{isLive ? 'LIVE' : 'PAUSED'}</span>
          </div>
        </div>
      </div>

      {/* Database stats banner cards */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="stat-card">
          <div className="stat-icon-box">
            <MapPin size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.stopsCount ?? 0}</span>
            <span className="stat-label">Geocoded Stops</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-box">
            <Database size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.routesCount ?? 0}</span>
            <span className="stat-label">Base Routes</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-box">
            <Navigation size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.learnedRoutesCount ?? 0}</span>
            <span className="stat-label">Learned Variations</span>
          </div>
        </div>

        <div 
          className="stat-card" 
          onClick={() => setSpeedFilter('all')}
          style={{ 
            cursor: 'pointer',
            borderLeft: '3px solid #6b7280',
            borderBottom: speedFilter === 'all' ? '2.5px solid #f59e0b' : 'none',
            background: speedFilter === 'all' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(17, 24, 39, 0.6)',
            boxShadow: speedFilter === 'all' ? '0 0 12px rgba(245, 158, 11, 0.15)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          <div className="stat-icon-box" style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#d1d5db' }}>
            <Bus size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{buses.length}</span>
            <span className="stat-label">Total Online</span>
          </div>
        </div>

        <div 
          className="stat-card" 
          onClick={() => setSpeedFilter('moving')}
          style={{ 
            cursor: 'pointer',
            borderLeft: '3px solid #10b981',
            borderBottom: speedFilter === 'moving' ? '2.5px solid #10b981' : 'none',
            background: speedFilter === 'moving' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(17, 24, 39, 0.6)',
            boxShadow: speedFilter === 'moving' ? '0 0 12px rgba(16, 185, 129, 0.2)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          <div className="stat-icon-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
            <Activity size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{movingBusesCount}</span>
            <span className="stat-label">Running (Moving)</span>
          </div>
        </div>

        <div 
          className="stat-card" 
          onClick={() => setSpeedFilter('halted')}
          style={{ 
            cursor: 'pointer',
            borderLeft: '3px solid #ef4444',
            borderBottom: speedFilter === 'halted' ? '2.5px solid #ef4444' : 'none',
            background: speedFilter === 'halted' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(17, 24, 39, 0.6)',
            boxShadow: speedFilter === 'halted' ? '0 0 12px rgba(239, 68, 68, 0.2)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          <div className="stat-icon-box" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
            <Bus size={20} style={{ opacity: 0.7 }} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{haltedBusesCount}</span>
            <span className="stat-label">Offline (Depot)</span>
          </div>
        </div>
      </div>

      {/* Main admin monitoring workspace */}
      {viewMode === 'console' ? (
        <div className="admin-workspace">
          
          {/* Left Side: Real-Time Scrolling Console */}
          <div className="console-panel">
            <div className="console-header">
              <div className="console-window-dots">
                <span className="win-dot red"></span>
                <span className="win-dot yellow"></span>
                <span className="win-dot green"></span>
              </div>
              <div className="console-title">
                <TerminalIcon size={14} /> GPS Ingestion Logs (2s Poll)
              </div>
              <div></div>
            </div>
            
            <div className="console-terminal">
              {logs.length === 0 ? (
                <div style={{ color: '#475569', fontStyle: 'italic', padding: '12px' }}>
                  Waiting for incoming GPS pings or seeder events...
                </div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="log-line">
                    <span className="log-time">[{formatTime(log.timestamp)}]</span>
                    <span className={`log-badge ${getLogTypeBadgeClass(log.type)}`}>
                      {log.type}
                    </span>
                    <span className={`log-msg ${getLogStatusClass(log.status)}`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={terminalEndRef} />
            </div>
          </div>

          {/* Right Side: Active Buses Tracker Grid */}
          <div className="buses-panel">
            <div className="panel-header" style={{ borderBottom: 'none', marginBottom: 0 }}>
              <div className="panel-title">
                <Activity size={16} style={{ color: '#10b981' }} /> Active Buses Tracked
              </div>
              <span className="bus-count-badge">
                {filteredBuses.length === buses.length 
                  ? `${stats?.activeBusesCount ?? 0} running` 
                  : `${filteredBuses.length} matched / ${stats?.activeBusesCount ?? 0}`}
              </span>
            </div>

            <div className="search-container">
              <input
                type="text"
                placeholder="Search by Registration No, Route Name, or Stop..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />
            </div>

            <div className="buses-table-wrapper">
              {filteredBuses.length === 0 ? (
                <div style={{ color: '#4b5563', fontStyle: 'italic', padding: '24px', textAlign: 'center' }}>
                  {buses.length === 0 
                    ? "No active buses currently transmitting coordinates." 
                    : "No buses match your search filter."}
                </div>
              ) : (
                <table className="buses-table">
                  <thead>
                    <tr>
                      <th>Reg No</th>
                      <th>Route / Destination</th>
                      <th>Coord (Lat, Lng)</th>
                      <th>Speed / Head</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedBuses.map((bus) => (
                      <tr key={`${bus.busId ?? ''}-${bus.regNo}`}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <span className="bus-badge-reg">{bus.regNo}</span>
                            {bus.isNewlyDetected && <span className="new-bus-tag">NEW</span>}
                          </div>
                        </td>
                        <td>
                          <div className="text-truncate" title={bus.routeName || 'Unknown Route'}>
                            {bus.routeName || 'Dynamic Discovery'}
                          </div>
                          <div style={{ fontSize: '10px', color: '#6b7280' }} className="text-truncate">
                            Near: {bus.currentStop || 'En-route'}
                          </div>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                          <div>{bus.latitude.toFixed(4)}, {bus.longitude.toFixed(4)}</div>
                          {bus.zoneName && (
                            <div style={{ fontSize: '9px', color: '#8b5cf6', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={bus.zoneName}>
                              <MapPin size={8} style={{ display: 'inline', marginRight: '2px' }}/>{bus.zoneName}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Compass size={12} style={{ transform: `rotate(${bus.heading}deg)`, color: '#6b7280' }} />
                            <span>{Math.round(bus.speed)} km/h</span>
                          </div>
                        </td>
                        <td>
                          {(() => {
                            const isMoving = (bus.speed ?? 0) >= 5;
                            const badgeClass = isMoving ? 'moving' : 'halted';
                            const badgeText = isMoving ? 'MOVING' : 'HALTED';
                            return (
                              <span className={`status-badge ${badgeClass}`}>
                                {badgeText}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination Controls */}
            {filteredBuses.length > 0 && (
              <div className="pagination-container">
                <button 
                  className="pagination-btn" 
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span>
                  Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({filteredBuses.length} items)
                </span>
                <button 
                  className="pagination-btn" 
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            )}
          </div>

        </div>
      ) : viewMode === 'map' ? (
        <div style={{ height: 'calc(100vh - 200px)', minHeight: '560px', background: 'rgba(17, 24, 39, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px', padding: '12px', boxSizing: 'border-box' }}>
          <LiveMap buses={buses} refreshTrigger={refreshTrigger} />
        </div>
      ) : (
        <div style={{ height: 'calc(100vh - 200px)', minHeight: '560px', background: 'rgba(17, 24, 39, 0.6)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '12px', padding: '40px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          
          <div className="coverage-container" style={{ width: '100%', maxWidth: '800px', marginBottom: '0' }}>
            <div className="coverage-left">
              <div className="coverage-header">
                <div className="coverage-title">
                  <Compass size={16} color="#10b981" />
                  <span>UP Route Network Coverage</span>
                </div>
                <div className="coverage-stats">
                  <strong>{currentRoutes}</strong> / {TARGET_ROUTES} Estimated Routes ({coveragePercent}%)
                </div>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${coveragePercent}%` }}></div>
              </div>
            </div>
            
            <div className="coverage-right">
              <div className="donut-container">
                <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
                  {/* Remaining / Background (Blue) */}
                  <circle 
                    cx="70" cy="70" r={donutRadius} 
                    fill="transparent" 
                    stroke="#2563eb" 
                    strokeWidth="24" 
                  />
                  {/* Completed (Green) */}
                  <circle 
                    cx="70" cy="70" r={donutRadius} 
                    fill="transparent" 
                    stroke="#10b981" 
                    strokeWidth="24" 
                    strokeDasharray={donutStrokeDasharray}
                    strokeLinecap="butt"
                    style={{ transition: 'stroke-dasharray 1s ease-in-out' }}
                  />
                </svg>
                <div className="donut-hole-text">
                  {coveragePercent}%
                </div>
              </div>
              <div className="donut-legend">
                <div className="legend-item">
                  <div className="legend-dot" style={{ background: '#10b981' }}></div>
                  <span>Completed</span>
                </div>
                <div className="legend-item">
                  <div className="legend-dot" style={{ background: '#2563eb' }}></div>
                  <span>Remaining</span>
                </div>
              </div>
            </div>
          </div>

          <div className="coverage-container" style={{ width: '100%', maxWidth: '800px', marginTop: '24px' }}>
            <div className="coverage-left">
              <div className="coverage-header">
                <div className="coverage-title">
                  <Navigation size={16} color="#a855f7" />
                  <span>AI Learned Route Variations</span>
                </div>
                <div className="coverage-stats">
                  <strong>{stats?.learnedRoutesCount || 0}</strong> Discovered
                </div>
              </div>
              <div className="progress-track" style={{ background: 'rgba(168, 85, 247, 0.1)' }}>
                {/* 100% width since these are purely additive, no upper bound */}
                <div className="progress-fill" style={{ width: '100%', background: 'linear-gradient(90deg, #a855f7 0%, #c084fc 100%)' }}></div>
              </div>
            </div>
            
            <div className="coverage-right">
              <div className="donut-container">
                <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
                  <circle 
                    cx="70" cy="70" r={donutRadius} 
                    fill="transparent" 
                    stroke="#a855f7" 
                    strokeWidth="24" 
                  />
                </svg>
                <div className="donut-hole-text" style={{ fontSize: '18px' }}>
                  {stats?.learnedRoutesCount || 0}
                </div>
              </div>
              <div className="donut-legend">
                <div className="legend-item">
                  <div className="legend-dot" style={{ background: '#a855f7' }}></div>
                  <span>New Variations</span>
                </div>
              </div>
            </div>
          </div>
          
        </div>
      )}
    </div>
  );
}
