import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { searchRead, odooCall, listStaffEmployees } from '../../../services/odoo';
import { useTheme } from '../../../context/ThemeContext';
import { RefreshCw, MapPin, Clock, Navigation, Users, CircleDot } from 'lucide-react';

interface Employee { id: number; name: string; }
interface Pos { employee_id: number; employee_name: string; lat: number; lng: number; accuracy: number; battery: number; is_moving: boolean; logged_at: string; }
interface DayRec {
  id: number; employee_id: [number, string]; status: string;
  check_in?: string | false; check_out?: string | false;
  geo_lat_in: number; geo_lng_in: number; geo_lat_out: number; geo_lng_out: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeOf = (dt?: string | false) => {
  if (!dt) return '—';
  const d = new Date(dt.replace(' ', 'T') + (dt.includes('Z') ? '' : 'Z'));
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};
const agoOf = (dt?: string) => {
  if (!dt) return 'never';
  const d = new Date(dt.replace(' ', 'T') + 'Z'); const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now'; if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60); return `${h}h ${mins % 60}m ago`;
};

const COLORS = ['#7367f0', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#3b82f6'];
const pinIcon = (color: string, label: string, live: boolean) => L.divIcon({
  className: '', iconSize: [34, 34], iconAnchor: [17, 17],
  html: `<div style="position:relative"><div style="width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font-weight:800;font-size:12px">${label}</span></div>${live ? `<span style="position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid #fff;animation:pulse 1.5s infinite"></span>` : ''}</div>`,
});

export default function LiveMap() {
  const { isDark } = useTheme();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<number, L.Marker>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [positions, setPositions] = useState<Pos[]>([]);
  const [days, setDays] = useState<DayRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [selId, setSelId] = useState<number | null>(null);

  const txt = isDark ? 'text-white' : 'text-gray-900';
  const sub = isDark ? 'text-[#5a6a8a]' : 'text-gray-400';
  const card = isDark ? 'bg-[#161b2e] border-[#2a3250]' : 'bg-white border-gray-200';

  const colorOf = (empId: number) => COLORS[employees.findIndex(e => e.id === empId) % COLORS.length] || '#7367f0';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [emps, pos, dd] = await Promise.all([
        listStaffEmployees<Employee>(['id', 'name']),
        odooCall<Pos[]>('robifel.employee.location', 'latest_positions', [], {}),
        searchRead<DayRec>('robifel.attendance.day', { fields: ['id', 'employee_id', 'status', 'check_in', 'check_out', 'geo_lat_in', 'geo_lng_in', 'geo_lat_out', 'geo_lng_out'], domain: [['date', '=', todayStr()]], limit: 0 }),
      ]);
      setEmployees(emps || []); setPositions(pos || []); setDays(dd || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  // init map
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false }).setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Best-known location per employee: live ping > today's check-in.
  const pointFor = (empId: number): { lat: number; lng: number; live: boolean } | null => {
    const p = positions.find(x => x.employee_id === empId);
    if (p && (p.lat || p.lng)) return { lat: p.lat, lng: p.lng, live: true };
    const d = days.find(x => x.employee_id?.[0] === empId);
    if (d && (d.geo_lat_in || d.geo_lng_in)) return { lat: d.geo_lat_in, lng: d.geo_lng_in, live: false };
    return null;
  };

  // render markers
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const seen = new Set<number>();
    const bounds: L.LatLngExpression[] = [];
    for (const emp of employees) {
      const pt = pointFor(emp.id); if (!pt) continue;
      seen.add(emp.id); bounds.push([pt.lat, pt.lng]);
      const day = days.find(d => d.employee_id?.[0] === emp.id);
      const html = `<div style="font-family:system-ui;min-width:140px"><b>${emp.name}</b><br/><span style="color:#10b981">In:</span> ${timeOf(day?.check_in)} &nbsp; <span style="color:#ef4444">Out:</span> ${timeOf(day?.check_out)}<br/><small style="color:#888">${pt.live ? 'Live' : 'Check-in location'}</small></div>`;
      if (markersRef.current[emp.id]) {
        markersRef.current[emp.id].setLatLng([pt.lat, pt.lng]).setIcon(pinIcon(colorOf(emp.id), emp.name[0].toUpperCase(), pt.live)).setPopupContent(html);
      } else {
        const m = L.marker([pt.lat, pt.lng], { icon: pinIcon(colorOf(emp.id), emp.name[0].toUpperCase(), pt.live) }).addTo(map).bindPopup(html);
        m.on('click', () => setSelId(emp.id));
        markersRef.current[emp.id] = m;
      }
    }
    // remove stale
    for (const idStr of Object.keys(markersRef.current)) {
      const id = Number(idStr);
      if (!seen.has(id)) { map.removeLayer(markersRef.current[id]); delete markersRef.current[id]; }
    }
    if (bounds.length && !selId) map.fitBounds(bounds as any, { padding: [50, 50], maxZoom: 15 });
  }, [employees, positions, days]); // eslint-disable-line

  const focus = (empId: number) => {
    const pt = pointFor(empId); const m = markersRef.current[empId];
    setSelId(empId);
    if (pt && mapRef.current) { mapRef.current.setView([pt.lat, pt.lng], 16, { animate: true }); m?.openPopup(); }
  };

  const tracked = employees.filter(e => pointFor(e.id));

  return (
    <div className="max-w-6xl mx-auto pb-8 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className={`text-xl font-black ${txt}`}>Live Location</h1>
          <p className={`text-xs mt-0.5 ${sub}`}>{tracked.length} of {employees.length} staff located · auto-refresh 30s</p>
        </div>
        <button onClick={load} className="btn-secondary text-xs px-3 py-2 flex items-center gap-1.5"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Map — isolate creates a stacking context so Leaflet's high z-index
            controls (z-1000) stay contained and don't overlap the sidebar (z-50). */}
        <div className={`card border ${card} overflow-hidden relative isolate z-0`} style={{ height: '70vh', minHeight: 420 }}>
          <div ref={mapEl} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* Side list */}
        <div className="space-y-2">
          <div className={`card border ${card} p-3 flex items-center gap-2`}>
            <Users size={15} className="text-[#7367f0]" /><span className={`text-xs font-bold ${txt}`}>Staff</span>
          </div>
          {employees.map(emp => {
            const pt = pointFor(emp.id);
            const p = positions.find(x => x.employee_id === emp.id);
            const day = days.find(d => d.employee_id?.[0] === emp.id);
            return (
              <button key={emp.id} onClick={() => pt && focus(emp.id)} disabled={!pt}
                className={`w-full card border ${card} p-3 text-left transition-all ${selId === emp.id ? 'ring-2 ring-[#7367f0]' : ''} ${!pt ? 'opacity-50' : 'hover:border-[#7367f0]/50'}`}>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: colorOf(emp.id) }}>{emp.name[0].toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold truncate ${txt}`}>{emp.name}</p>
                    <p className={`text-[11px] flex items-center gap-1 ${sub}`}>
                      {pt?.live ? <><CircleDot size={10} className="text-emerald-500" /> {agoOf(p?.logged_at)}</> : pt ? <><MapPin size={10} /> at check-in</> : 'no location'}
                    </p>
                  </div>
                  {pt && <Navigation size={13} className="text-[#7367f0]" />}
                </div>
                {day && (
                  <div className={`flex gap-3 mt-2 pt-2 border-t text-[11px] ${isDark ? 'border-[#2a3250]' : 'border-gray-100'}`}>
                    <span className="flex items-center gap-1 text-emerald-500"><Clock size={11} /> In {timeOf(day.check_in)}</span>
                    <span className="flex items-center gap-1 text-rose-500"><Clock size={11} /> Out {timeOf(day.check_out)}</span>
                  </div>
                )}
              </button>
            );
          })}
          {!loading && tracked.length === 0 && <p className={`text-center text-xs py-6 ${sub}`}>No staff located yet. Locations appear once employees check in or their app sends a ping.</p>}
        </div>
      </div>
    </div>
  );
}
