// Interfaz superpuesta del visor 3D.
import { useEffect, useMemo, useState } from 'react';
import { ZONES, ZONE_IDS, DEFAULT_PLACEMENTS } from '../../../shared/zones.js';
import { fmtClock, fmtEur, fmtDur, SIM_SPEEDS, SHIFTS, ROLES, PRODUCTS, SPECIES, TONES } from '../../../shared/config.js';
import { T_ALARM } from '../../../shared/sim/twin.js';
import { useNet, live } from '../../net/client.js';
import { useUI } from '../ui.js';

const EV_CLASS = { err: 'err', warn: 'warn', ok: 'ok', twin: 'info', plc: 'info', info: '' };

function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t); }, [msg]);
  return [msg, setMsg];
}

function LoginModal({ api, onClose, reason }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const r = await api.login(u, p);
    if (!r.ok) setErr(r.error || 'No se pudo iniciar sesión'); else onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <form className="panel modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Iniciar sesión</h3>
        <p className="muted small">{reason || 'Para cambiar la planta hace falta el usuario de gerencia.'}</p>
        <label>Usuario<input value={u} onChange={(e) => setU(e.target.value)} autoFocus /></label>
        <label>Clave<input type="password" value={p} onChange={(e) => setP(e.target.value)} /></label>
        {err && <p className="err small">{err}</p>}
        <div className="row"><button className="btn primary" type="submit">Entrar</button><button className="btn ghost" type="button" onClick={onClose}>Cancelar</button></div>
      </form>
    </div>
  );
}

function TopBar({ api, toast }) {
  const t = useNet((s) => s.tickT);
  const mode = useNet((s) => s.mode), status = useNet((s) => s.status);
  const user = useNet((s) => s.user);
  const tk = live.tick;
  const hud = tk?.hud || {};
  const isAdmin = user?.role === 'gerente';
  const edit = useUI((s) => s.edit);
  const showLabels = useUI((s) => s.showLabels);
  const placements = useNet((s) => s.scene?.placements);
  const [login, setLogin] = useState(null);
  const act = async (a, p) => { const r = await api.action(a, p); if (!r.ok) toast(r.error || 'No se pudo'); };
  const startEdit = () => { if (!isAdmin) { setLogin('Para mover las secciones hace falta el usuario de gerencia.'); return; } useUI.getState().setEdit(true, placements || DEFAULT_PLACEMENTS); };
  return (
    <header className="topbar panel">
      <div className="brand">
        <div className="logo">GD</div>
        <div><h1>Planta de madera · Gemelo digital</h1><p>{mode === 'local' ? 'Simulación en este navegador' : status === 'conectado' ? 'Conectado al servidor' : 'Reconectando…'}</p></div>
      </div>
      <div className="clock"><b>{tk ? fmtClock(t) : '—'}</b><span>Turno de {SHIFTS[hud.shift]?.name.toLowerCase() || '—'} · {tk?.running ? `×${tk.speed}` : 'en pausa'}</span></div>
      <div className="group kpis">
        <div className="kpi"><span>Caja</span><b className={hud.cash < 0 ? 'err' : ''}>{fmtEur(hud.cash || 0)}</b></div>
        <div className="kpi"><span>Uds. turno</span><b>{hud.shiftUnits ?? 0}</b></div>
        <div className="kpi"><span>Pedidos</span><b>{hud.openOrders ?? 0}{hud.offers ? <small className="warn"> +{hud.offers}</small> : null}</b></div>
        <div className="kpi"><span>Línea</span><b className={tk?.line?.blocked ? 'warn' : 'ok'} title={tk?.line?.blocked}>{tk?.line?.blocked ? 'Parada' : 'En marcha'}</b></div>
      </div>
      {isAdmin && (
        <div className="group">
          <button className="btn icon" title={tk?.running ? 'Pausa' : 'Continuar'} onClick={() => act('setRunning', { running: !tk?.running })}>{tk?.running ? '❚❚' : '▶'}</button>
          <select className="speed" value={tk?.speed || 1} title="Velocidad de la simulación" onChange={(e) => act('setSimSpeed', { speed: +e.target.value })}>{SIM_SPEEDS.map((s) => <option key={s} value={s}>×{s}</option>)}</select>
        </div>
      )}
      <div className="group">
        <label className="switch"><input type="checkbox" checked={showLabels} onChange={() => useUI.getState().toggleLabels()} /><span>Etiquetas</span></label>
        {!edit && <button className="btn" onClick={startEdit}>✥ Editar planta</button>}
        <a className="btn" href="/admin/" target="_blank" rel="noreferrer">Admin</a>
        <a className="btn" href="/app/" target="_blank" rel="noreferrer">App móvil</a>
        {user ? <button className="btn ghost" title="Cerrar sesión" onClick={() => api.logout()}>{user.name.split(' ')[0]} ⎋</button>
          : <button className="btn ghost" onClick={() => setLogin('')}>Entrar</button>}
      </div>
      {login !== null && <LoginModal api={api} reason={login} onClose={() => setLogin(null)} />}
    </header>
  );
}

function focusZone(plant, id) {
  const z = plant.zones[id];
  const [lx, lz] = z.def.size;
  const d = Math.max(lx, lz) * 0.9 + 6;
  useUI.getState().setFocus({ pos: [z.pl.x + d * 0.35, d * 0.75, z.pl.z + d * 0.95], target: [z.pl.x, 1, z.pl.z] });
}

function LeftPanel({ plant }) {
  const [open, setOpen] = useState(true);
  useNet((s) => s.tickT);
  const tk = live.tick;
  if (!open) return <aside className="side left panel collapsed"><button className="collapse" onClick={() => setOpen(true)}>›</button></aside>;
  return (
    <aside className="side left panel">
      <button className="collapse" onClick={() => setOpen(false)}>‹</button>
      <section>
        <h2>Secciones</h2>
        <div className="zone-list">
          {ZONE_IDS.map((id) => (
            <button key={id} className="zone-item" onClick={() => focusZone(plant, id)}>
              <i style={{ background: ZONES[id].color }} />{ZONES[id].short}
              {ZONES[id].cell && tk && <ZoneRobots id={id} />}
            </button>
          ))}
        </div>
      </section>
      <section>
        <h2>Puestos de este turno</h2>
        {tk && Object.values(tk.posts || {}).map((p) => (
          <div key={p.id} className="post">
            <span className={`dot ${p.staffed ? 'ok' : 'err'}`} />
            <div><b>{p.name}</b><p className="muted small">{p.staffed ? p.who.join(', ') : `Sin personal · se detiene ${p.stops}`}</p></div>
          </div>
        ))}
      </section>
      <section>
        <h2>AGV</h2>
        {tk?.logistics?.agvs.map((a) => (
          <button key={a.id} className="agv-row" onClick={() => useUI.getState().select(a.id)}>
            <b>{a.id}</b><span className={`chip ${a.state === 'WAIT' ? 'warn' : a.state === 'IDLE' ? '' : 'ok'}`}>{a.state === 'MOVING' ? 'en ruta' : a.state === 'WAIT' ? 'espera' : a.state === 'ACTION' ? 'carga' : 'libre'}</span>
            <span className="muted small">{a.state === 'WAIT' ? a.wait : a.mission}</span>
            <span className="batt"><i style={{ width: `${a.battery}%`, background: a.battery < 25 ? 'var(--err)' : 'var(--ok)' }} /></span>
          </button>
        ))}
      </section>
    </aside>
  );
}
function ZoneRobots({ id }) {
  const rs = Object.values(live.tick.robots).filter((r) => r.cellId === id);
  return <span className="right zr">{rs.map((r) => <i key={r.id} className={`dot ${r.status === 'FAULT' ? 'err' : r.status === 'MAINT' ? 'info' : r.temp > T_ALARM - 10 ? 'warn' : 'ok'}`} title={r.id} />)}</span>;
}

function Bar({ v, max = 1, warn, err }) {
  const k = Math.max(0, Math.min(1, v / max));
  const c = err !== undefined && v >= err ? 'var(--err)' : warn !== undefined && v >= warn ? 'var(--warn)' : 'var(--ok)';
  return <span className="bar"><i style={{ width: `${k * 100}%`, background: c }} /></span>;
}

function RobotDetail({ id, api, toast }) {
  useNet((s) => s.tickT);
  const user = useNet((s) => s.user);
  const r = live.tick?.robots?.[id];
  if (!r) return null;
  const isAdmin = user?.role === 'gerente';
  const st = { RUN: ['ok', 'En marcha'], MAINT: ['info', 'Mantenimiento'], FAULT: ['err', 'Avería'] }[r.status];
  const set = async (p) => { const res = await api.action('setRobot', { robotId: id, ...p }); if (!res.ok) toast(res.error); };
  return (
    <section>
      <h3>{id} <span className={`chip ${st[0]}`}>{st[1]}</span></h3>
      <p className="muted small">{ZONES[r.cellId].name}{r.reason ? ` · ${r.reason}` : ''}</p>
      <div className="metrics">
        <div><span>Temperatura</span><b>{r.temp.toFixed(1)} °C</b><Bar v={r.temp} max={120} warn={T_ALARM - 10} err={T_ALARM} /></div>
        <div><span>Desgaste reductora</span><b>{Math.round(r.wear * 100)} %</b><Bar v={r.wear} warn={0.6} err={0.85} /></div>
        <div><span>Vida útil estimada</span><b>{r.rul > 9999 ? '> 9999 h' : `${r.rul} h`}</b></div>
        <div><span>Ciclo (duty)</span><b>{Math.round(r.duty * 100)} %</b></div>
        <div><span>Corriente</span><b>{r.current.toFixed(1)} A</b></div>
        <div><span>Reparto</span><b>{r.share.toFixed(1)}</b></div>
        <div><span>Velocidad</span><b>{Math.round(r.speed * 100)} %{r.accelF < 1 ? ' · acel. −12 %' : ''}</b></div>
        <div><span>Ciclos</span><b>{r.cycles}</b></div>
      </div>
      {isAdmin ? (
        <div className="ctl">
          <label className="small">Velocidad del robot · {Math.round(r.speed * 100)} %
            <input type="range" min="50" max="130" step="5" value={Math.round(r.speed * 100)} onChange={(e) => set({ speed: +e.target.value / 100 })} />
          </label>
          <p className="muted small">Más velocidad = más producción, pero más calor y desgaste (× v²).</p>
        </div>
      ) : <p className="muted small">Inicia sesión como gerencia para cambiar la velocidad.</p>}
    </section>
  );
}

function AgvDetail({ id }) {
  useNet((s) => s.tickT);
  const a = live.tick?.logistics?.agvs.find((x) => x.id === id);
  if (!a) return null;
  return (
    <section>
      <h3>{a.id} <span className="chip">{a.type === 'fork' ? 'carretilla' : 'elevación'}</span></h3>
      <p className="muted small">{a.label}</p>
      <div className="metrics">
        <div><span>Estado</span><b>{a.state}</b></div>
        <div><span>Misión</span><b>{a.mission}</b></div>
        {a.wait && <div><span>Espera</span><b className="warn">{a.wait}</b></div>}
        <div><span>Batería</span><b>{Math.round(a.battery)} %</b><Bar v={100 - a.battery} max={100} warn={70} err={80} /></div>
        <div><span>Recorrido</span><b>{(a.travel / 1000).toFixed(1)} km</b></div>
        <div><span>Carga</span><b>{a.load ? (a.load.kind === 'stack' ? `Pila ${a.load.dry ? 'seca' : 'verde'} de ${SPECIES[a.load.species]?.name.toLowerCase()} (${a.load.boards} tablas)` : `Palé ${a.load.pallet?.id} · ${a.load.pallet?.units} ${PRODUCTS[a.load.pallet?.product]?.unit}`) : '—'}</b></div>
      </div>
      <p className="muted small">La línea discontinua es la ruta A* calculada sobre la rejilla de la planta.</p>
    </section>
  );
}

function LineOverview() {
  useNet((s) => s.tickT);
  const st = useNet((s) => s.state);
  const tk = live.tick;
  if (!tk) return null;
  const L = tk.line;
  return (
    <section>
      <h2>Línea de producción</h2>
      <p className={L.blocked ? 'warn' : 'ok'}>{L.blocked || (L.phase === 'TRANSFER' ? 'Avanzando bandejas' : 'Trabajando')}</p>
      <p className="muted small">Último ciclo {L.lastCycle ? `${L.lastCycle.toFixed(0)} s` : '—'} · medio {L.avgCycle ? `${L.avgCycle.toFixed(0)} s` : '—'}</p>
      <div className="trays">
        {['CEP', 'CNC', 'LIJ', 'ENS', 'BAR', 'PAL'].map((s, i) => {
          const tr = L.trays[i];
          const w = L.work?.[s];
          return (
            <div key={s} className="tray">
              <b>{s}</b>
              {tr ? <span>{PRODUCTS[tr.product].name} · {SPECIES[tr.species].name}{tr.tone !== 'natural' ? ` · ${TONES[tr.tone].name}` : ''}</span> : <span className="muted">vacía</span>}
              {tr && !tr.route.includes(s) && s !== 'PAL' ? <em className="muted">no pasa</em> : w?.wait ? <em className="warn">{w.wait}</em> : null}
            </div>
          );
        })}
      </div>
      {st && (
        <>
          <h2 style={{ marginTop: 14 }}>Plan de fabricación</h2>
          {st.plan.filter((p) => p.status !== 'HECHA').slice(0, 6).map((p) => (
            <div key={p.id} className="po">
              <b>{p.id}</b> {p.qty} {PRODUCTS[p.product].unit} de {SPECIES[p.species].name.toLowerCase()}
              <Bar v={p.done} max={p.qty} />
              <span className="muted small">{p.done}/{p.qty} · {p.orderId || 'stock'} · ruta {p.route.join('→')}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function RightPanel({ api, toast }) {
  const sel = useUI((s) => s.selected);
  const [open, setOpen] = useState(true);
  if (!open) return <aside className="side right panel collapsed"><button className="collapse" onClick={() => setOpen(true)}>‹</button></aside>;
  const isRobot = sel && live.tick?.robots?.[sel];
  const isAgv = sel?.startsWith('AGV');
  return (
    <aside className="side right panel">
      <button className="collapse" onClick={() => setOpen(false)}>›</button>
      {isRobot ? <RobotDetail id={sel} api={api} toast={toast} /> : isAgv ? <AgvDetail id={sel} /> : <LineOverview />}
      {sel && <button className="btn small" onClick={() => useUI.getState().select(null)}>Cerrar detalle</button>}
      <Twin />
    </aside>
  );
}

function Twin() {
  const st = useNet((s) => s.state);
  const rec = st?.recommendation;
  if (!st) return null;
  return (
    <section>
      <h2>Gemelo · decisión de turno {st.settings.twinEnabled ? '' : <span className="chip warn">desactivado</span>}</h2>
      {!rec ? <p className="muted small">Se calcula 15 min después de cada cambio de turno.</p> : (
        <>
          <p className="small"><span className={`chip ${rec.status === 'PENDIENTE' ? 'warn' : rec.status === 'APROBADA' ? 'ok' : ''}`}>{rec.status}</span> {fmtClock(rec.at)}{rec.by ? ` · ${rec.by}` : ''}</p>
          {rec.items.map((it, i) => <p key={i} className="small">• {it.text}</p>)}
          {rec.status === 'PENDIENTE' && <p className="muted small">La aprueba el jefe de turno desde su app (o la administración).</p>}
        </>
      )}
      <p className="muted small">Paradas no programadas: <b>{st.kpi.unplanned}</b> · simultáneas: <b>{st.kpi.simultaneous}</b> · preventivos: <b>{st.kpi.maint}</b> · sin paradas: {fmtDur(st.kpi.sinceStop)}</p>
    </section>
  );
}

function Ticker() {
  const st = useNet((s) => s.state);
  const ev = st?.events?.slice(0, 5) || [];
  return (
    <footer className="ticker panel">
      {ev.map((e, i) => <span key={`${e.t}-${i}`} className={EV_CLASS[e.level] || ''}><b>{fmtClock(e.t, false)}</b> {e.msg}</span>)}
    </footer>
  );
}

// ── Modo edición ─────────────────────────────────────────────────────────────
function EditPanel({ api, usePlant, toast }) {
  const draft = useUI((s) => s.draft);
  const editZone = useUI((s) => s.editZone);
  const plant = usePlant();
  const placements = useNet((s) => s.scene?.placements);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const key = (e) => {
      const { editZone: z, draft: d, setDraft } = useUI.getState();
      if (!z || !ZONES[z].movable || e.target.tagName === 'INPUT') return;
      const step = e.shiftKey ? 5 : 1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (e.key === 'r' || e.key === 'R') setDraft({ ...d, [z]: { ...d[z], rot: (d[z].rot + 1) % 4 } });
      else if (mv) { e.preventDefault(); setDraft({ ...d, [z]: { ...d[z], x: d[z].x + mv[0], z: d[z].z + mv[1] } }); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const changed = useMemo(() => ZONE_IDS.filter((id) => JSON.stringify(draft[id]) !== JSON.stringify(placements?.[id])), [draft, placements]);
  const apply = async () => {
    setBusy(true);
    const r = await api.action('applyLayout', { placements: draft });
    setBusy(false);
    if (!r.ok) { toast(r.error || 'Distribución no válida'); return; }
    toast('Distribución aplicada · la planta se reorganiza');
    useUI.getState().setEdit(false);
  };
  const rot = (id) => useUI.getState().setDraft({ ...draft, [id]: { ...draft[id], rot: (draft[id].rot + 1) % 4 } });
  return (
    <aside className="side right panel edit-panel">
      <section>
        <h2>Modo edición</h2>
        <p className="small">Arrastra una sección para moverla (rejilla de 1 m). <b>R</b> gira 90°, flechas = mover (⇧ ×5).</p>
        <p className="muted small">La cinta se reenruta sola entre estaciones y los AGV recalculan sus rutas. Las zonas en rojo no son válidas.</p>
      </section>
      <section>
        <h2>Secciones</h2>
        <div className="zone-list">
          {ZONE_IDS.map((id) => (
            <div key={id} className={`zone-item ${editZone === id ? 'on' : ''}`} onClick={() => { useUI.getState().setEditZone(id); focusZone(plant, id); }}>
              <i style={{ background: ZONES[id].color }} />{ZONES[id].short}
              <span className="right muted small">{draft[id].x}, {draft[id].z} · {draft[id].rot * 90}°</span>
              {ZONES[id].movable ? <button className="btn icon" title="Girar 90°" onClick={(e) => { e.stopPropagation(); rot(id); }}>⟳</button> : <span className="chip">fija</span>}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Validación</h2>
        {plant.valid ? <p className="ok">✓ Distribución válida · cinta de {plant.conveyor.length.toFixed(1)} m</p>
          : plant.errors.slice(0, 8).map((e, i) => <p key={i} className="err small">✕ {e.msg}</p>)}
        <p className="muted small">{changed.length ? `${changed.length} sección(es) modificada(s): ${changed.join(', ')}` : 'Sin cambios'}</p>
      </section>
      <div className="row">
        <button className="btn primary" disabled={!plant.valid || !changed.length || busy} onClick={apply}>Aplicar</button>
        <button className="btn" onClick={() => useUI.getState().setDraft(structuredClone(DEFAULT_PLACEMENTS))}>Distribución inicial</button>
        <button className="btn ghost" onClick={() => useUI.getState().setEdit(false)}>Cancelar</button>
      </div>
    </aside>
  );
}

export function Hud({ api, usePlant }) {
  const edit = useUI((s) => s.edit);
  const plant = usePlant();
  const [msg, toast] = useToast();
  return (
    <div className="hud">
      <TopBar api={api} toast={toast} />
      {!edit && <LeftPanel plant={plant} />}
      {edit ? <EditPanel api={api} usePlant={usePlant} toast={toast} /> : <RightPanel api={api} toast={toast} />}
      {!edit && <Ticker />}
      {msg && <div className="toast panel">{msg}</div>}
      {edit && <div className="edit-banner panel">MODO EDICIÓN · los cambios no se aplican hasta pulsar «Aplicar»</div>}
    </div>
  );
}

export { ROLES };
