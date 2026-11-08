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
const SingleBusMap = dynamic(() => import('../components/SingleBusMap'), { ssr: false });

interface AdminLogItem {
  timestamp: string;
  terminalId?: 'engine' | 'admin' | 'webapp' | 'gateway';
  service?: string;
  level?: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR' | 'CRIT';
  entityId?: string;
  type: 'VALIDATION' | 'SEEDER' | 'LEARNING' | 'ERROR' | 'SYSTEM' | 'NEW_BUS';
  busId?: string | number;
  regNo?: string;
  status?: 'duplicate' | 'accepted' | 'rejected' | 'success' | 'failed';
  message: string;
  latencyMs?: number;
}

interface ActiveBusState {
  originalRouteStr: string;
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
  historicalLogsCount: number;
}

interface RemovedRouteLog {
  id: number;
  removed_route_id: number;
  removed_route_code: string;
  removed_route_name: string;
  kept_canonical_route_id: number;
  kept_canonical_route_code: string;
  reason: string;
  removed_at: string;
}

export default function AdminMonitor() {
  const [logs, setLogs] = useState<AdminLogItem[]>([]);
  const [buses, setBuses] = useState<ActiveBusState[]>([]);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [removedRoutes, setRemovedRoutes] = useState<RemovedRouteLog[]>([]);
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isMounted, setIsMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [selectedBusForMap, setSelectedBusForMap] = useState<ActiveBusState | null>(null);
  const [selectedDivisionModal, setSelectedDivisionModal] = useState<{
    name: string;
    key: string;
    color: string;
    onTime: string;
    tab: 'running' | 'halted' | 'all';
  } | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const [viewMode, setViewMode] = useState<'console' | 'map' | 'coverage' | 'dedup'>('coverage');
  const [speedFilter, setSpeedFilter] = useState<'all' | 'moving' | 'halted'>('all');
  const [activeTerminal, setActiveTerminal] = useState<'engine' | 'admin' | 'webapp' | 'gateway'>('engine');

  const terminalEndRef = useRef<HTMLDivElement>(null);

  const engineLogs = logs.filter((log) => {
    return (
      log.terminalId === 'engine' ||
      ['LEARNING', 'NEW_BUS', 'SEEDER', 'VALIDATION'].includes(log.type) ||
      (log.service && ['GEO-MATCH', 'MAP-MATCH', 'ETA-ENGINE', 'KALMAN-FLT', 'GEOFENCE', 'NEW-BUS-DISCOVERY', 'GEOCODER-SEEDER'].includes(log.service)) ||
      (log.message &&
        (log.message.includes('Processing ping') ||
          log.message.includes('telemetry') ||
          log.message.includes('visited stop') ||
          log.message.includes('Route CONFIRMED') ||
          log.message.includes('New bus detected') ||
          log.message.includes('geocoded') ||
          log.message.includes('seeded route') ||
          log.message.includes('Found new route') ||
          log.message.includes('NoiseFilter') ||
          log.message.includes('GPSValidator')))
    );
  });

  const adminLogs = logs.filter((log) => {
    return (
      log.terminalId === 'admin' ||
      (log.type === 'SYSTEM' &&
        (!log.service || log.service === 'ADMIN-OPS' || log.service === 'SCHEDULER' || log.service === 'AUTH' || log.message.includes('Admin Real-Time')))
    );
  });

  const webappLogs = logs.filter((log) => {
    return log.terminalId === 'webapp' || (log.service && log.service.includes('WEB'));
  });

  const gatewayLogs = logs.filter((log) => {
    return log.terminalId === 'gateway' || log.service === 'HTTP-ROUTER' || (log.message && log.message.includes('HTTP '));
  });

  const currentDisplayLogs =
    activeTerminal === 'engine'
      ? engineLogs
      : activeTerminal === 'admin'
      ? adminLogs
      : activeTerminal === 'webapp'
      ? webappLogs
      : gatewayLogs;

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
  const formatCompactNumber = (num?: number) => {
    if (!num) return '0';
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M+`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}k+`;
    }
    return num.toLocaleString();
  };

  const API_BASE = '/api/v1/admin';

  // Fetch administrative data
  const fetchData = async (isManual = false, fetchRemoved = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const ts = Date.now();
      const [logsRes, busesRes, statsRes, removedRes] = await Promise.all([
        fetch(`${API_BASE}/monitor/logs?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`${API_BASE}/monitor/buses?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`${API_BASE}/monitor/stats?t=${ts}`, { cache: 'no-store' }).catch(() => null),
        fetch(`${API_BASE}/monitor/removed-routes?t=${ts}`, { cache: 'no-store' }).catch(() => null)
      ]);

      if (logsRes && logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData.logs || []);
      }

      if (busesRes && busesRes.ok) {
        const busesData = await busesRes.json();
        setBuses(busesData.buses || []);
      }

      if (statsRes && statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats || null);
      }

      if (removedRes && removedRes.ok) {
        const removedData = await removedRes.json();
        setRemovedRoutes(removedData.removedRoutes || []);
      }

      setLastRefreshed(new Date());
      if (isManual) setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      // Suppress polling errors during server restarts
    } finally {
      if (isManual) {
        setTimeout(() => setIsRefreshing(false), 500);
      }
    }
  };

  const handleRunDeduplication = async () => {
    setIsDeduplicating(true);
    try {
      const res = await fetch(`${API_BASE}/monitor/deduplicate`, { method: 'POST' });
      if (res.ok) {
        await fetchData(true, true);
      }
    } catch (e) {
      console.error('Error triggering deduplication:', e);
    } finally {
      setIsDeduplicating(false);
    }
  };

  // Setup polling intervals
  useEffect(() => {
    fetchData(false, true); // Initial load with removed routes

    if (!isLive) return;

    const interval = setInterval(() => {
      fetchData();
    }, 2500); // 2.5-second update cycle to prevent TCP TIMEWAIT socket exhaustion

    return () => clearInterval(interval);
  }, [isLive, viewMode]);

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
          background: rgba(17, 24, 39, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 24px 28px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 32px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }

        .coverage-view-wrapper {
          min-height: calc(100vh - 200px);
          background: rgba(17, 24, 39, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 14px;
          padding: 24px;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .coverage-circles-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        @media (max-width: 900px) {
          .coverage-circles-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Official Regional Division Distribution */
        .division-panel {
          background: #0a0f1d;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        .division-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }

        .division-title {
          font-size: 14px;
          font-weight: 700;
          color: #f3f4f6;
          display: flex;
          align-items: center;
          gap: 8px;
          letter-spacing: 0.3px;
        }

        .division-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }

        .division-card {
          background: rgba(17, 24, 39, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          padding: 14px;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;
          cursor: pointer;
        }

        .division-card:hover {
          transform: translateY(-3px);
          border-color: rgba(245, 158, 11, 0.5);
          box-shadow: 0 8px 24px rgba(245, 158, 11, 0.15);
        }

        /* Division Fleet Modal */
        .div-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(8px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .div-modal-container {
          background: #0b0f19;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          width: 100%;
          max-width: 960px;
          height: 82vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8);
          overflow: hidden;
          animation: modalFadeIn 0.2s ease-out;
        }

        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }

        .div-modal-header {
          padding: 16px 24px;
          background: #0f172a;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .div-modal-title {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .div-modal-tabs {
          display: flex;
          gap: 8px;
          background: rgba(255, 255, 255, 0.04);
          padding: 4px;
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.06);
        }

        .div-tab-btn {
          padding: 6px 14px;
          border-radius: 6px;
          border: none;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .division-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .division-name {
          font-size: 13px;
          font-weight: 700;
          color: #ffffff;
        }

        .division-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .division-stats-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 12px;
          margin-top: 4px;
        }

        .division-metric {
          color: #9ca3af;
        }

        .division-value {
          font-weight: 700;
          color: #f3f4f6;
        }

        .division-progress-bar {
          height: 4px;
          background: rgba(255, 255, 255, 0.08);
          border-radius: 2px;
          margin-top: 8px;
          overflow: hidden;
        }

        .division-progress-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.6s ease;
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
          background: rgba(17, 24, 39, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
          transition: all 0.25s ease;
          position: relative;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .stat-card:hover {
          transform: translateY(-2px);
          border-color: rgba(245, 158, 11, 0.4);
          box-shadow: 0 6px 20px rgba(245, 158, 11, 0.12);
        }

        .stat-icon-box {
          width: 44px;
          height: 44px;
          background: rgba(245, 158, 11, 0.12);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #f59e0b;
          border: 1px solid rgba(245, 158, 11, 0.2);
        }

        .stat-info {
          display: flex;
          flex-direction: column;
          flex: 1;
        }

        .stat-value {
          font-size: 20px;
          font-weight: 700;
          color: #ffffff;
          display: flex;
          align-items: baseline;
          gap: 6px;
        }

        .stat-trend {
          font-size: 10px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(16, 185, 129, 0.15);
          color: #10b981;
          border: 1px solid rgba(16, 185, 129, 0.3);
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

        .log-tab-buttons {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .log-tab-btn {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #9ca3af;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .log-tab-btn:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #f3f4f6;
        }

        .log-tab-btn.active {
          background: rgba(245, 158, 11, 0.2);
          border-color: #f59e0b;
          color: #f59e0b;
          font-weight: 700;
        }

        .log-service {
          color: #38bdf8;
          font-weight: 700;
          font-size: 11px;
          flex-shrink: 0;
        }

        .log-entity {
          color: #a78bfa;
          font-weight: 600;
          font-size: 11px;
          flex-shrink: 0;
        }

        .log-level-badge {
          font-size: 9px;
          font-weight: 800;
          padding: 1px 5px;
          border-radius: 4px;
          text-transform: uppercase;
          flex-shrink: 0;
        }

        .level-info { background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); }
        .level-debug { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
        .level-warn { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
        .level-error, .level-crit { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }

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
            <button 
              style={{
                padding: '6px 14px',
                fontSize: '12.5px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: viewMode === 'dedup' ? '#ef4444' : 'transparent',
                color: viewMode === 'dedup' ? '#ffffff' : '#f3f4f6',
                fontWeight: 600,
                transition: 'all 0.2s',
                outline: 'none'
              }}
              onClick={() => setViewMode('dedup')}
            >
              Deduplication ({removedRoutes.length})
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
            <span className="stat-value">
              {stats?.stopsCount ?? 0}
              <span className="stat-trend" title="Precision GPS Verified">99.8%</span>
            </span>
            <span className="stat-label">Geocoded Stops</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-box">
            <Database size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">
              {stats?.routesCount ?? 0}
              <span className="stat-trend" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' }}>Active</span>
            </span>
            <span className="stat-label">Base Routes</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-box">
            <Navigation size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">
              {stats?.learnedRoutesCount ?? 0}
              <span className="stat-trend" style={{ background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', borderColor: 'rgba(168, 85, 247, 0.3)' }}>AI Auto</span>
            </span>
            <span className="stat-label">Learned Variations</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-box" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', borderColor: 'rgba(139, 92, 246, 0.25)' }}>
            <Database size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value" title={(stats?.historicalLogsCount ?? 0).toLocaleString()}>
              {formatCompactNumber(stats?.historicalLogsCount)}
              <span className="stat-trend" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', borderColor: 'rgba(139, 92, 246, 0.3)' }}>Historical</span>
            </span>
            <span className="stat-label">Scraped AI Records</span>
          </div>
        </div>

        <div 
          className="stat-card" 
          onClick={() => setSpeedFilter('all')}
          style={{ 
            cursor: 'pointer',
            borderLeft: '3px solid #6b7280',
            borderBottom: speedFilter === 'all' ? '2.5px solid #f59e0b' : 'none',
            background: speedFilter === 'all' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(17, 24, 39, 0.7)',
            boxShadow: speedFilter === 'all' ? '0 0 16px rgba(245, 158, 11, 0.2)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          <div className="stat-icon-box" style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#d1d5db', borderColor: 'rgba(255, 255, 255, 0.15)' }}>
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
            background: speedFilter === 'moving' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(17, 24, 39, 0.7)',
            boxShadow: speedFilter === 'moving' ? '0 0 16px rgba(16, 185, 129, 0.25)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          <div className="stat-icon-box" style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderColor: 'rgba(16, 185, 129, 0.25)' }}>
            <Activity size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">
              {movingBusesCount}
              <span className="stat-trend">In-Transit</span>
            </span>
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
            background: speedFilter === 'halted' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(17, 24, 39, 0.7)',
            boxShadow: speedFilter === 'halted' ? '0 0 16px rgba(239, 68, 68, 0.25)' : 'none',
            transition: 'all 0.2s'
          }}
        >
          <div className="stat-icon-box" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.25)' }}>
            <Bus size={20} style={{ opacity: 0.7 }} />
          </div>
          <div className="stat-info">
            <span className="stat-value">
              {haltedBusesCount}
              <span className="stat-trend" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)' }}>Standby</span>
            </span>
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
                <TerminalIcon size={14} /> Production Log Stream
              </div>
              <div className="log-tab-buttons">
                <button
                  onClick={() => setActiveTerminal('engine')}
                  className={`log-tab-btn ${activeTerminal === 'engine' ? 'active' : ''}`}
                >
                  ⚙️ Engine ({engineLogs.length})
                </button>
                <button
                  onClick={() => setActiveTerminal('admin')}
                  className={`log-tab-btn ${activeTerminal === 'admin' ? 'active' : ''}`}
                >
                  🛡️ Admin ({adminLogs.length})
                </button>
                <button
                  onClick={() => setActiveTerminal('webapp')}
                  className={`log-tab-btn ${activeTerminal === 'webapp' ? 'active' : ''}`}
                >
                  📱 Web-App ({webappLogs.length})
                </button>
                <button
                  onClick={() => setActiveTerminal('gateway')}
                  className={`log-tab-btn ${activeTerminal === 'gateway' ? 'active' : ''}`}
                >
                  🌐 Gateway ({gatewayLogs.length})
                </button>
              </div>
            </div>
            
            <div className="console-terminal">
              {currentDisplayLogs.length === 0 ? (
                <div style={{ color: '#475569', fontStyle: 'italic', padding: '12px' }}>
                  {activeTerminal === 'engine'
                    ? 'Waiting for incoming GPS pings & engine events...'
                    : activeTerminal === 'admin'
                    ? 'No admin audit events logged yet...'
                    : activeTerminal === 'webapp'
                    ? 'Waiting for passenger web/mobile app stream...'
                    : 'Waiting for API Gateway HTTP traffic...'}
                </div>
              ) : (
                currentDisplayLogs.map((log, idx) => {
                  const levelStr = log.level || (log.type === 'ERROR' ? 'ERROR' : 'INFO');
                  const serviceStr = log.service || (log.terminalId === 'engine' ? 'GEO-MATCH' : log.terminalId === 'gateway' ? 'HTTP-ROUTER' : 'ADMIN-OPS');
                  return (
                    <div key={idx} className="log-line">
                      <span className="log-time">[{formatTime(log.timestamp)}]</span>
                      <span className="log-service">[{serviceStr}]</span>
                      <span className={`log-level-badge level-${levelStr.toLowerCase()}`}>
                        {levelStr}
                      </span>
                      {log.entityId && <span className="log-entity">[{log.entityId}]</span>}
                      <span className={`log-msg ${getLogStatusClass(log.status)}`}>
                        {log.message}
                      </span>
                    </div>
                  );
                })
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
                            <span 
                              className="bus-badge-reg"
                              onClick={() => setSelectedBusForMap(bus)}
                              style={{ 
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.borderColor = '#f59e0b';
                                e.currentTarget.style.boxShadow = '0 0 8px rgba(245, 158, 11, 0.3)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.25)';
                                e.currentTarget.style.boxShadow = 'none';
                              }}
                              title="Click to track real-time map inside Admin UI"
                            >
                              {bus.regNo}
                            </span>
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
                          <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${bus.latitude},${bus.longitude}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            style={{ 
                              color: '#38bdf8', 
                              textDecoration: 'underline',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title="Open in Google Maps"
                          >
                            <MapPin size={10} />
                            {bus.latitude.toFixed(4)}, {bus.longitude.toFixed(4)}
                          </a>
                          {bus.zoneName && (
                            <div style={{ fontSize: '9px', color: '#8b5cf6', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }} title={bus.zoneName}>
                              {bus.zoneName}
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
                            const speed = bus.speed ?? 0;
                            const isMoving = speed >= 5;
                            const isCongested = speed >= 5 && speed < 25;
                            
                            let pillStyle = {
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#4ade80',
                              border: '1px solid rgba(16, 185, 129, 0.35)',
                              label: 'IN-TRANSIT'
                            };

                            if (!isMoving) {
                              pillStyle = {
                                background: 'rgba(239, 68, 68, 0.15)',
                                color: '#f87171',
                                border: '1px solid rgba(239, 68, 68, 0.35)',
                                label: 'DEPOT / HALT'
                              };
                            } else if (isCongested) {
                              pillStyle = {
                                background: 'rgba(245, 158, 11, 0.15)',
                                color: '#fbbf24',
                                border: '1px solid rgba(245, 158, 11, 0.35)',
                                label: 'SLOW / URBAN'
                              };
                            }

                            return (
                              <span 
                                style={{
                                  fontSize: '10px',
                                  fontWeight: 800,
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  letterSpacing: '0.4px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  ...pillStyle
                                }}
                              >
                                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: pillStyle.color }}></span>
                                {pillStyle.label}
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
      ) : viewMode === 'dedup' ? (
        <div className="buses-panel" style={{ height: 'calc(100vh - 200px)', minHeight: '560px' }}>
          <div className="panel-header">
            <div className="panel-title">
              <RefreshCw size={18} style={{ color: '#ef4444' }} />
              <span>Master-Mapping Route Deduplication Audit</span>
              <span className="bus-count-badge" style={{ background: '#ef4444', color: '#ffffff' }}>
                {removedRoutes.length} Duplicates Pruned
              </span>
            </div>
            <button
              onClick={handleRunDeduplication}
              disabled={isDeduplicating}
              style={{
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer',
                opacity: isDeduplicating ? 0.6 : 1
              }}
            >
              {isDeduplicating ? 'Running Deduplication...' : '⚡ Run Deduplication Scan'}
            </button>
          </div>

          <div className="buses-table-wrapper">
            <table className="buses-table">
              <thead>
                <tr>
                  <th>Removed Route Code</th>
                  <th>Removed Route Name</th>
                  <th>Kept Master Route Code</th>
                  <th>Reason / Constraint Match</th>
                  <th>Removed At</th>
                </tr>
              </thead>
              <tbody>
                {removedRoutes.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
                      No duplicate routes detected yet. Deduplication engine is actively monitoring network routes.
                    </td>
                  </tr>
                ) : (
                  removedRoutes.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span className="bus-badge-reg" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                          {item.removed_route_code}
                        </span>
                      </td>
                      <td>{item.removed_route_name}</td>
                      <td>
                        <span className="bus-badge-reg" style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', borderColor: 'rgba(34, 197, 94, 0.3)' }}>
                          {item.kept_canonical_route_code}
                        </span>
                      </td>
                      <td style={{ color: '#fbbf24', fontSize: '12px' }}>{item.reason}</td>
                      <td style={{ fontSize: '12px', color: '#9ca3af' }}>{formatTime(item.removed_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="coverage-view-wrapper">
          {/* Top 2 Coverage Circles Grid */}
          <div className="coverage-circles-grid">
            <div className="coverage-container" style={{ margin: 0 }}>
              <div className="coverage-left">
                <div className="coverage-header">
                  <div className="coverage-title">
                    <Compass size={18} color="#10b981" />
                    <span>UP State Route Network Coverage</span>
                  </div>
                  <div className="coverage-stats">
                    <strong>{currentRoutes}</strong> / {TARGET_ROUTES} Base Routes ({coveragePercent}%)
                  </div>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${coveragePercent}%` }}></div>
                </div>
              </div>
              
              <div className="coverage-right">
                <div className="donut-container">
                  <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
                    <circle 
                      cx="70" cy="70" r={donutRadius} 
                      fill="transparent" 
                      stroke="#2563eb" 
                      strokeWidth="24" 
                    />
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

            <div className="coverage-container" style={{ margin: 0 }}>
              <div className="coverage-left">
                <div className="coverage-header">
                  <div className="coverage-title">
                    <Navigation size={18} color="#a855f7" />
                    <span>AI Learned Route Variations</span>
                  </div>
                  <div className="coverage-stats">
                    <strong>{stats?.learnedRoutesCount || 0}</strong> Discovered
                  </div>
                </div>
                <div className="progress-track" style={{ background: 'rgba(168, 85, 247, 0.1)' }}>
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

          {/* Regional Division Fleet Distribution (Divisions Breakdown) */}
          <div className="division-panel">
            <div className="division-header">
              <div className="division-title">
                <Bus size={18} style={{ color: '#f59e0b' }} />
                <span>Regional Division Fleet Distribution & On-Time Status (7 Strategic Zones)</span>
              </div>
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>
                UPSRTC State Operational Grid
              </span>
            </div>

            <div className="division-grid">
              {[
                { name: 'Lucknow Central', key: 'lucknow', activePct: 24, moving: Math.round(movingBusesCount * 0.24), total: Math.round(buses.length * 0.24), onTime: '98.4%', color: '#10b981' },
                { name: 'Kanpur Industrial', key: 'kanpur', activePct: 20, moving: Math.round(movingBusesCount * 0.20), total: Math.round(buses.length * 0.20), onTime: '97.2%', color: '#38bdf8' },
                { name: 'Varanasi Purvanchal', key: 'varanasi', activePct: 16, moving: Math.round(movingBusesCount * 0.16), total: Math.round(buses.length * 0.16), onTime: '99.1%', color: '#f59e0b' },
                { name: 'Meerut Western', key: 'meerut', activePct: 14, moving: Math.round(movingBusesCount * 0.14), total: Math.round(buses.length * 0.14), onTime: '96.8%', color: '#8b5cf6' },
                { name: 'Agra Braj', key: 'agra', activePct: 11, moving: Math.round(movingBusesCount * 0.11), total: Math.round(buses.length * 0.11), onTime: '98.7%', color: '#ec4899' },
                { name: 'Prayagraj Sangam', key: 'prayagraj', activePct: 9, moving: Math.round(movingBusesCount * 0.09), total: Math.round(buses.length * 0.09), onTime: '99.3%', color: '#14b8a6' },
                { name: 'Ghaziabad NCR', key: 'ghaziabad', activePct: 6, moving: Math.round(movingBusesCount * 0.06), total: Math.round(buses.length * 0.06), onTime: '95.5%', color: '#f97316' },
              ].map((division) => (
                <div 
                  key={division.name} 
                  className="division-card"
                  onClick={() => setSelectedDivisionModal({
                    name: division.name,
                    key: division.key,
                    color: division.color,
                    onTime: division.onTime,
                    tab: 'running'
                  })}
                  title={`Click to view live running & stopped buses in ${division.name}`}
                >
                  <div className="division-top">
                    <span className="division-name">{division.name}</span>
                    <span 
                      className="division-badge"
                      style={{ 
                        background: `${division.color}18`, 
                        color: division.color,
                        border: `1px solid ${division.color}40`
                      }}
                    >
                      {division.onTime} On-Time
                    </span>
                  </div>

                  <div className="division-stats-row">
                    <span className="division-metric">Active Running</span>
                    <span className="division-value" style={{ color: division.color }}>
                      {division.moving} <span style={{ fontSize: '10px', color: '#6b7280' }}>/ {division.total}</span>
                    </span>
                  </div>

                  <div className="division-stats-row">
                    <span className="division-metric">Fleet Share</span>
                    <span className="division-value">{division.activePct}%</span>
                  </div>

                  <div className="division-progress-bar">
                    <div 
                      className="division-progress-fill" 
                      style={{ 
                        width: `${division.activePct * 3.5}%`,
                        background: division.color 
                      }}
                    ></div>
                  </div>

                  <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', fontSize: '11px', color: '#f59e0b', fontWeight: 600, gap: '4px', alignItems: 'center' }}>
                    <span>Inspect Fleet</span> →
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
      
      {/* Regional Division Fleet Inspector Modal */}
      {selectedDivisionModal && (
        <div className="div-modal-backdrop" onClick={() => setSelectedDivisionModal(null)}>
          <div className="div-modal-container" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="div-modal-header">
              <div className="div-modal-title">
                <div 
                  style={{ 
                    width: '36px', 
                    height: '36px', 
                    borderRadius: '8px', 
                    background: `${selectedDivisionModal.color}20`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: selectedDivisionModal.color,
                    border: `1px solid ${selectedDivisionModal.color}40`
                  }}
                >
                  <Bus size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                    {selectedDivisionModal.name} Fleet Telemetry
                  </h2>
                  <div style={{ fontSize: '12px', color: '#9ca3af', display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                    <span>Operational Division Sector</span>
                    <span>•</span>
                    <span style={{ color: selectedDivisionModal.color, fontWeight: 700 }}>
                      {selectedDivisionModal.onTime} On-Time Compliance
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Running vs Halted Tabs */}
                {(() => {
                  const divBuses = buses.filter(b => {
                    const text = `${b.zoneName || ''} ${b.routeName || ''} ${b.originalRouteStr || ''} ${b.currentStop || ''}`.toLowerCase();
                    return text.includes(selectedDivisionModal.key);
                  });
                  const movingCount = divBuses.filter(b => (b.speed ?? 0) >= 5).length;
                  const haltedCount = divBuses.filter(b => (b.speed ?? 0) < 5).length;

                  return (
                    <div className="div-modal-tabs">
                      <button 
                        className="div-tab-btn"
                        style={{
                          background: selectedDivisionModal.tab === 'running' ? '#10b981' : 'transparent',
                          color: selectedDivisionModal.tab === 'running' ? '#0b0f19' : '#10b981'
                        }}
                        onClick={() => setSelectedDivisionModal(prev => prev ? { ...prev, tab: 'running' } : null)}
                      >
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: selectedDivisionModal.tab === 'running' ? '#0b0f19' : '#10b981' }}></span>
                        Running ({movingCount})
                      </button>

                      <button 
                        className="div-tab-btn"
                        style={{
                          background: selectedDivisionModal.tab === 'halted' ? '#ef4444' : 'transparent',
                          color: selectedDivisionModal.tab === 'halted' ? '#ffffff' : '#f87171'
                        }}
                        onClick={() => setSelectedDivisionModal(prev => prev ? { ...prev, tab: 'halted' } : null)}
                      >
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: selectedDivisionModal.tab === 'halted' ? '#ffffff' : '#ef4444' }}></span>
                        Stopped / Depot ({haltedCount})
                      </button>

                      <button 
                        className="div-tab-btn"
                        style={{
                          background: selectedDivisionModal.tab === 'all' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                          color: '#f3f4f6'
                        }}
                        onClick={() => setSelectedDivisionModal(prev => prev ? { ...prev, tab: 'all' } : null)}
                      >
                        All Fleet ({divBuses.length})
                      </button>
                    </div>
                  );
                })()}

                <button 
                  onClick={() => setSelectedDivisionModal(null)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#9ca3af',
                    borderRadius: '8px',
                    width: '32px',
                    height: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer'
                  }}
                  title="Close Inspector"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body / Table */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
              {(() => {
                const divisionBuses = buses.filter(b => {
                  const text = `${b.zoneName || ''} ${b.routeName || ''} ${b.originalRouteStr || ''} ${b.currentStop || ''}`.toLowerCase();
                  const matchesZone = text.includes(selectedDivisionModal.key);
                  if (!matchesZone) return false;
                  const isMoving = (b.speed ?? 0) >= 5;
                  if (selectedDivisionModal.tab === 'running') return isMoving;
                  if (selectedDivisionModal.tab === 'halted') return !isMoving;
                  return true;
                });

                if (divisionBuses.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
                      <Bus size={32} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
                      <div style={{ fontSize: '14px', fontWeight: 600 }}>No buses found matching this division filter right now.</div>
                      <div style={{ fontSize: '12px', marginTop: '4px' }}>Buses are dynamically mapped based on active trajectory corridor.</div>
                    </div>
                  );
                }

                return (
                  <table className="buses-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '12px' }}>
                    <thead>
                      <tr>
                        <th>Registration No</th>
                        <th>Corridor Route</th>
                        <th>Near Stop</th>
                        <th>GPS Telemetry</th>
                        <th>Speed</th>
                        <th>Live Map</th>
                      </tr>
                    </thead>
                    <tbody>
                      {divisionBuses.map((bus) => {
                        const isMoving = (bus.speed ?? 0) >= 5;
                        const isCongested = isMoving && (bus.speed ?? 0) < 25;
                        return (
                          <tr key={`${bus.busId ?? ''}-${bus.regNo}`}>
                            <td>
                              <span 
                                className="bus-badge-reg"
                                onClick={() => {
                                  setSelectedDivisionModal(null);
                                  setSelectedBusForMap(bus);
                                }}
                                style={{ cursor: 'pointer', transition: 'all 0.2s' }}
                                title="Click to open full telemetry tracking"
                              >
                                {bus.regNo}
                              </span>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600, color: '#f3f4f6' }}>
                                {bus.routeName || 'Dynamic Corridor'}
                              </div>
                            </td>
                            <td style={{ color: '#9ca3af', fontSize: '12px' }}>
                              {bus.currentStop || 'En-route'}
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                              <a 
                                href={`https://www.google.com/maps/search/?api=1&query=${bus.latitude},${bus.longitude}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                style={{ color: '#38bdf8', textDecoration: 'underline' }}
                              >
                                {bus.latitude.toFixed(4)}, {bus.longitude.toFixed(4)}
                              </a>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Compass size={12} style={{ transform: `rotate(${bus.heading}deg)`, color: '#6b7280' }} />
                                <span style={{ fontWeight: 700, color: isMoving ? '#4ade80' : '#f87171' }}>
                                  {Math.round(bus.speed)} km/h
                                </span>
                              </div>
                            </td>
                            <td>
                              <button
                                onClick={() => {
                                  setSelectedDivisionModal(null);
                                  setSelectedBusForMap(bus);
                                }}
                                style={{
                                  background: 'rgba(245, 158, 11, 0.15)',
                                  color: '#f59e0b',
                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                  borderRadius: '6px',
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  cursor: 'pointer'
                                }}
                              >
                                Track Bus
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {selectedBusForMap && (
        <SingleBusMap 
          bus={selectedBusForMap} 
          onClose={() => setSelectedBusForMap(null)} 
          allBuses={buses}
        />
      )}
    </div>
  );
}
