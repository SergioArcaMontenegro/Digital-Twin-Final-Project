// ─────────────────────────────────────────────────────────────────────────────
// App móvil del operario (PWA). Cada trabajador entra con su usuario y clave y ve lo
// que corresponde a su función: lo que ha fabricado en su turno, los pedidos en curso,
// sus tareas (aprobar, autorizar paradas, recibir camiones, expedir…) e incidencias.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { connect, useNet } from '../net/client.js';
import {
  PRODUCTS, SPECIES, SPECIES_IDS, TONES, ROLES, SHIFTS, POSTS, fmtEur, fmtClock, fmtDur, onShift, BOARDS_PER_LOG,
} from '../../shared/config.js';
import { ZONES, ZONE_IDS } from '../../shared/zones.js';
import { T_ALARM } from '../../shared/sim/twin.js';
import { useToast, useAct, Toast, LoginForm, Bar, Chip, productLabel, ORDER_TONE, ORDER_NAME, Empty, ConnBadge } from '../ui/common.jsx';
import '../ui/apps.css';
import './mobile.css';

const api = connect({ want: ['state'], app: 'app' });

const TASK_LABEL = {
  APROBAR: { ok: 'Aprobar', no: 'Rechazar' }, OT_PREV: { ok: 'Autorizar parada en HMI' }, OT_CORR: { ok: 'Empezar reparación' },
  RECEPCION: { ok: 'Dar entrada al camión' }, EXPEDICION: { ok: 'Confirmar salida' }, OFERTA: { ok: 'Aceptar pedido', no: 'Rechazar' },
};
const MY_ZONES = (u) => POSTS.filter((p) => p.role === u.role).flatMap((p) => p.zones);

export default function MobileApp() {
  const user = useNet((s) => s.user);
  const st = useNet((s) => s.state);
  const [tab, setTab] = useState('inicio');
  const [msg, toast] = useToast();
  const act = useAct(api, toast);
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js').catch(() => {}); }, []);
  if (!user) {
    return (
      <div className="mobile">
        <LoginForm api={api} title="App de planta" subtitle="Entra con tu usuario y clave" hint="Tu usuario y tu clave te los da la administración de la planta." />
      </div>
    );
  }
  if (!st || !st.me) return <div className="mobile"><div className="loading">Cargando…</div></div>;
  const me = st.me;
  const myTasks = st.tasks.filter((t) => (t.role === me.role || me.role === 'gerente') && (t.status === 'PENDIENTE' || t.status === 'EN_CURSO'));
  const present = me.role === 'gerente' || onShift(me.shift, st.t);
  return (
    <div className="mobile">
      <header className="m-head">
        <div className="avatar" style={{ background: ROLES[me.role].color }}>{me.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
        <div className="who"><b>{me.name}</b><span>{ROLES[me.role].name} · {ZONES[me.zone]?.short}</span></div>
        <div className="shift"><Chip tone={present ? 'ok' : ''}>{present ? 'En turno' : 'Fuera de turno'}</Chip><span>{fmtClock(st.t, false)}</span></div>
      </header>
      <main className="m-body">
        {tab === 'inicio' && <Home st={st} me={me} act={act} go={setTab} tasks={myTasks} />}
        {tab === 'tareas' && <Tasks st={st} me={me} act={act} tasks={myTasks} present={present} />}
        {tab === 'pedidos' && <Orders st={st} me={me} act={act} />}
        {tab === 'incid' && <Incidents st={st} me={me} act={act} />}
        {tab === 'perfil' && <Profile st={st} me={me} act={act} />}
      </main>
      <nav className="m-tabs">
        {[['inicio', 'Inicio', '⌂'], ['tareas', 'Tareas', '✓', myTasks.length], ['pedidos', 'Pedidos', '✉'], ['incid', 'Avisos', '⚠'], ['perfil', 'Perfil', '☺']].map(([id, name, ico, n]) => (
          <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><span>{ico}{n ? <em>{n}</em> : null}</span>{name}</button>
        ))}
      </nav>
      <Toast msg={msg} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function ShiftCard({ st, me }) {
  const mine = st.me.stats || {};
  const zone = st.zoneCount[st.shiftKey] || {};
  const keys = Object.keys(mine).slice(-6);
  const max = Math.max(1, ...keys.map((k) => mine[k]));
  const plantWide = ['jefe', 'gerente', 'comercial'].includes(me.role);
  const zoneUnits = ['aserrador'].includes(me.role) ? zone.ASE || 0 : me.role === 'cepillador' ? zone.CEP || 0 : me.role === 'mecanizado' ? (zone.CNC || 0) + (zone.LIJ || 0) : me.role === 'montaje' ? (zone.ENS || 0) + (zone.BAR || 0) : zone.PAL || 0;
  const unit = me.role === 'aserrador' ? 'troncos aserrados por ti' : me.role === 'mecanizado' || me.role === 'montaje' ? 'piezas procesadas por ti' : me.role === 'cepillador' ? 'unidades cepilladas por ti' : me.role === 'mantenimiento' ? 'órdenes de trabajo cerradas' : plantWide ? 'unidades terminadas en la planta' : 'unidades paletizadas por ti';
  const n = plantWide ? zone.PAL || 0 : mine[st.shiftKey] || 0;
  return (
    <section className="card hero">
      <h2>Fabricado en este turno</h2>
      <div className="hero-n"><b>{n}</b><span>{unit}</span></div>
      <p className="muted small">{plantWide ? `Troncos aserrados ${zone.ASE || 0} · cepilladas ${zone.CEP || 0} · ensambladas ${zone.ENS || 0}` : `En tu puesto este turno: ${zoneUnits} · planta: ${zone.PAL || 0} unidades terminadas`}</p>
      {keys.length > 1 && (
        <div className="bars">{keys.map((k) => <div key={k} title={k}><i style={{ height: `${(mine[k] / max) * 100}%` }} /><span>{k.replace(/(\d+)([MTN])/, 'D$1 $2')}</span></div>)}</div>
      )}
    </section>
  );
}

function CurrentWork({ st }) {
  const po = st.plan.find((p) => p.status === 'EN_CURSO') || st.plan.find((p) => p.status === 'PENDIENTE');
  return (
    <section className="card">
      <h2>Ahora en la línea</h2>
      <p className={st.line.blocked ? 'warn' : 'ok'}>{st.line.blocked || 'Línea en marcha'}</p>
      {po && <>
        <p><b>{po.id}</b> · {PRODUCTS[po.product].icon} {productLabel(po)}</p>
        <Bar v={po.done} max={po.qty} />
        <p className="muted small">{po.done}/{po.qty} · {po.orderId ? `pedido ${po.orderId}` : 'para stock'} · ruta {po.route.join('→')}</p>
      </>}
    </section>
  );
}

function RobotsCard({ st, cells }) {
  const rs = Object.values(st.robots).filter((r) => cells.includes(r.cellId));
  return (
    <section className="card">
      <h2>Robots de mi zona</h2>
      {rs.map((r) => (
        <div key={r.id} className="m-robot">
          <b>{r.id}</b>
          <Chip tone={r.status === 'FAULT' ? 'err' : r.status === 'MAINT' ? 'info' : r.temp > T_ALARM - 10 ? 'warn' : 'ok'}>{r.status === 'FAULT' ? 'avería' : r.status === 'MAINT' ? 'mant.' : 'marcha'}</Chip>
          <span className="muted small">{r.temp.toFixed(0)} °C · desg. {Math.round(r.wear * 100)} % · {Math.round(r.speed * 100)} %</span>
        </div>
      ))}
    </section>
  );
}

function Home({ st, me, act, go, tasks }) {
  const r = me.role;
  return (
    <>
      {tasks.length > 0 && (
        <button className="card alert" onClick={() => go('tareas')}>
          <b>Tienes {tasks.length} tarea{tasks.length > 1 ? 's' : ''} pendiente{tasks.length > 1 ? 's' : ''}</b>
          <span>{tasks[0].title} →</span>
        </button>
      )}
      <ShiftCard st={st} me={me} />
      {r === 'aserrador' && <SawHome st={st} />}
      {r === 'cepillador' && <PlanerHome st={st} />}
      {r === 'mecanizado' && <><CurrentWork st={st} /><RobotsCard st={st} cells={['CNC', 'LIJ']} /></>}
      {r === 'montaje' && <><CurrentWork st={st} /><RobotsCard st={st} cells={['ENS', 'BAR']} /></>}
      {r === 'logistica' && <LogisticsHome st={st} />}
      {r === 'mantenimiento' && <MaintHome st={st} />}
      {(r === 'jefe' || r === 'gerente') && <BossHome st={st} act={act} />}
      {r === 'comercial' && <SalesHome st={st} />}
      {!['jefe', 'gerente', 'comercial'].includes(r) && <IncomingOrders st={st} />}
    </>
  );
}

function SawHome({ st }) {
  const trucks = st.purchases.filter((p) => p.status !== 'RECIBIDO');
  return (
    <>
      <section className="card">
        <h2>Patio de troncos</h2>
        {SPECIES_IDS.map((k) => <div key={k} className="kv"><span>{SPECIES[k].name}</span><span className="grow"><Bar v={st.yard[k]} max={30} /></span><b>{st.yard[k]}</b></div>)}
      </section>
      <section className="card">
        <h2>Camiones de troncos</h2>
        {trucks.length ? trucks.map((p) => <div key={p.id} className="kv"><span>{p.id} · {p.logs} de {SPECIES[p.species].name.toLowerCase()}</span><b>{p.status === 'EN_CAMINO' ? `en ${fmtDur(Math.max(0, p.eta - st.t))}` : p.status.toLowerCase().replace('_', ' ')}</b></div>) : <Empty>No hay camiones en camino.</Empty>}
      </section>
      <section className="card">
        <h2>Secadero</h2>
        <div className="kv"><span>Pila verde</span><b>{st.greenPad.layers}/6 capas {st.greenPad.species ? `· ${SPECIES[st.greenPad.species].name.toLowerCase()}` : ''}</b></div>
        {st.kiln.map((k, i) => <div key={i} className="kv"><span>{SPECIES[k.species].name}</span><b className={k.left ? 'warn' : 'ok'}>{k.left ? `seca en ${fmtDur(k.left)}` : 'seca'}</b></div>)}
      </section>
    </>
  );
}
function PlanerHome({ st }) {
  const next = st.plan.filter((p) => p.started < p.qty && p.status !== 'CANCELADA').slice(0, 4);
  return (
    <>
      <section className="card">
        <h2>Pila seca en la cepilladora</h2>
        <div className="hero-n"><b>{st.dryPad.boards}</b><span>tablas de {SPECIES[st.dryPad.species]?.name.toLowerCase()}</span></div>
        <Bar v={st.dryPad.boards} max={36} />
      </section>
      <section className="card">
        <h2>Próximas órdenes</h2>
        {next.map((p) => <div key={p.id} className="kv"><span>{PRODUCTS[p.product].icon} {productLabel({ ...p, qty: p.qty - p.started })}</span><b>{PRODUCTS[p.product].boards} tablas/ud</b></div>)}
      </section>
      <CurrentWork st={st} />
    </>
  );
}
function LogisticsHome({ st }) {
  const pallets = st.stock.reduce((a, s) => a + s.pallets, 0);
  return (
    <>
      <section className="card">
        <h2>Almacén y muelle</h2>
        <div className="kv"><span>Palés en almacén</span><span className="grow"><Bar v={pallets} max={42} tone={pallets > 36 ? 'warn' : ''} /></span><b>{pallets}/42</b></div>
        <div className="kv"><span>Camión</span><b>{st.truck.state === 'DOCKED' ? `cargando ${st.truck.pallets}/10` : st.truck.state === 'AWAY' ? 'en ruta' : 'maniobrando'}</b></div>
      </section>
      <section className="card">
        <h2>AGV</h2>
        {st.agvs.map((a) => <div key={a.id} className="kv"><span><b>{a.id}</b> · {a.wait || a.mission}</span><b className={a.battery < 25 ? 'err' : ''}>{a.battery} %</b></div>)}
      </section>
    </>
  );
}
function MaintHome({ st }) {
  const rs = Object.values(st.robots).sort((a, b) => (b.status === 'FAULT') - (a.status === 'FAULT') || b.wear - a.wear);
  return (
    <section className="card">
      <h2>Estado de los brazos</h2>
      {rs.map((r) => (
        <div key={r.id} className="m-robot col">
          <div className="row"><b>{r.id}</b><Chip tone={r.status === 'FAULT' ? 'err' : r.status === 'MAINT' ? 'info' : r.wear > 0.75 ? 'warn' : 'ok'}>{r.status === 'FAULT' ? 'avería' : r.status === 'MAINT' ? 'mantenimiento' : 'marcha'}</Chip><span className="spacer" /><span className="muted small">RUL {r.rul > 9999 ? '>9999' : r.rul} h</span></div>
          <Bar v={r.wear} tone={r.wear > 0.85 ? 'err' : r.wear > 0.6 ? 'warn' : ''} />
          <span className="muted small">desgaste {Math.round(r.wear * 100)} % · {r.temp.toFixed(0)} °C{r.reason ? ` · ${r.reason}` : ''}</span>
        </div>
      ))}
    </section>
  );
}
function BossHome({ st, act }) {
  const rec = st.recommendation;
  return (
    <>
      <CurrentWork st={st} />
      <section className="card">
        <h2>Puestos del turno</h2>
        {Object.values(st.posts).map((p) => <div key={p.id} className="kv"><span>{p.name}</span><b className={p.staffed ? 'ok' : 'err'}>{p.staffed ? p.who.join(', ') : 'sin personal'}</b></div>)}
      </section>
      <section className="card">
        <h2>Gemelo · decisión de turno</h2>
        {!rec ? <Empty>Todavía no hay recomendación para este turno.</Empty> : (
          <>
            <p><Chip tone={rec.status === 'PENDIENTE' ? 'warn' : rec.status === 'APROBADA' ? 'ok' : ''}>{rec.status}</Chip> <span className="muted small">{fmtClock(rec.at)}</span></p>
            {rec.items.map((it, i) => <p key={i} className="small">• {it.text}</p>)}
            {rec.status === 'PENDIENTE' && <div className="row"><button className="btn primary" onClick={() => act('approveRec', {}, 'Aprobado')}>Aprobar</button><button className="btn" onClick={() => act('rejectRec', {})}>Rechazar</button></div>}
          </>
        )}
        <p className="muted small">Paradas no programadas: {st.kpi.unplanned} · preventivos: {st.kpi.maint}</p>
      </section>
    </>
  );
}
function SalesHome({ st }) {
  const offers = st.orders.filter((o) => o.status === 'OFERTA');
  const backlog = st.plan.reduce((a, p) => a + Math.max(0, p.qty - p.done), 0);
  return (
    <>
      <section className="card">
        <h2>Cartera</h2>
        <div className="kv"><span>Ofertas por responder</span><b className={offers.length ? 'warn' : ''}>{offers.length}</b></div>
        <div className="kv"><span>Carga de la línea</span><b>{backlog} uds · ~{fmtDur(backlog * Math.max(60, st.line.avgCycle || 90))}</b></div>
        <div className="kv"><span>Ventas hoy</span><b>{fmtEur(st.eco.today.venta || 0)}</b></div>
      </section>
      <section className="card">
        <h2>Stock libre</h2>
        {st.stock.filter((s) => s.free).map((s) => <div key={`${s.product}${s.species}${s.tone}`} className="kv"><span>{PRODUCTS[s.product].icon} {PRODUCTS[s.product].short} · {SPECIES[s.species].name}{s.tone !== 'natural' ? ` · ${TONES[s.tone].name}` : ''}</span><b>{s.free}</b></div>)}
        {!st.stock.some((s) => s.free) && <Empty>No hay stock libre.</Empty>}
      </section>
    </>
  );
}
function IncomingOrders({ st }) {
  const list = st.orders.filter((o) => ['ACEPTADO', 'EN_PRODUCCION', 'LISTO'].includes(o.status)).sort((a, b) => a.due - b.due).slice(0, 5);
  return (
    <section className="card">
      <h2>Pedidos en curso</h2>
      {list.length ? list.map((o) => <OrderRow key={o.id} o={o} t={st.t} />) : <Empty>Ningún pedido abierto.</Empty>}
    </section>
  );
}

function OrderRow({ o, t, children }) {
  const d = o.due - t;
  return (
    <div className="m-order">
      <div className="row"><b>{o.id}</b><Chip tone={ORDER_TONE[o.status]}>{ORDER_NAME[o.status]}</Chip><span className="spacer" /><span className={d < 0 ? 'err small' : d < 3 * 3600 ? 'warn small' : 'muted small'}>{d < 0 ? `retraso ${fmtDur(-d)}` : `entrega en ${fmtDur(d)}`}</span></div>
      <p>{PRODUCTS[o.product].icon} {productLabel(o)} · {o.client}</p>
      {o.status !== 'OFERTA' && <><Bar v={o.produced} max={o.qty} /><span className="muted small">{o.produced}/{o.qty} fabricadas · {o.shipped} enviadas</span></>}
      {children}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function Tasks({ st, me, act, tasks, present }) {
  const done = st.tasks.filter((t) => t.role === me.role && t.status === 'HECHA').slice(-8).reverse();
  return (
    <>
      {!present && <section className="card"><p className="warn">Estás fuera de tu turno ({SHIFTS[me.shift].name}). Puedes consultar, pero las tareas las hace quien está en planta.</p></section>}
      <section className="card">
        <h2>Pendientes</h2>
        {tasks.length ? tasks.map((t) => <TaskCard key={t.id} t={t} act={act} st={st} disabled={!present} />) : <Empty>No tienes tareas pendientes. 👍</Empty>}
      </section>
      <section className="card">
        <h2>Hechas recientemente</h2>
        {done.length ? done.map((t) => <div key={t.id} className="kv"><span>{t.title}</span><b className="muted small">{t.doneBy || ''} · {fmtClock(t.doneAt || t.createdAt, false)}</b></div>) : <Empty>—</Empty>}
      </section>
    </>
  );
}

function TaskCard({ t, act, st, disabled }) {
  const L = TASK_LABEL[t.type] || { ok: 'Hecho' };
  const order = t.type === 'OFERTA' ? st.orders.find((o) => `OFERTA:${o.id}` === t.ref) : null;
  return (
    <div className={`task ${t.urgent ? 'urgent' : ''}`}>
      <div className="row"><b>{t.title}</b>{t.status === 'EN_CURSO' && <Chip tone="info">en curso</Chip>}</div>
      {t.detail && <p className="small pre">{t.detail}</p>}
      {order && <p className="small">Entrega en {fmtDur(order.due - st.t)} · total {fmtEur(order.qty * order.unitPrice)}</p>}
      <p className="muted small">{ZONES[t.zone]?.short} · hace {fmtDur(st.t - t.createdAt)}</p>
      {t.status === 'PENDIENTE' && (
        <div className="row">
          <button className="btn primary" disabled={disabled} onClick={() => act('doTask', { id: t.id, action: 'approve' }, 'Hecho')}>{L.ok}</button>
          {L.no && <button className="btn" disabled={disabled} onClick={() => act('doTask', { id: t.id, action: 'reject' }, 'Hecho')}>{L.no}</button>}
        </div>
      )}
      {t.status === 'EN_CURSO' && <p className="muted small">Se cerrará sola al terminar el trabajo en la celda.</p>}
    </div>
  );
}

function Orders({ st, me, act }) {
  const offers = st.orders.filter((o) => o.status === 'OFERTA');
  const open = st.orders.filter((o) => ['ACEPTADO', 'EN_PRODUCCION', 'LISTO'].includes(o.status)).sort((a, b) => a.due - b.due);
  const recent = st.orders.filter((o) => o.status === 'ENVIADO').slice(-5).reverse();
  const canSell = me.role === 'comercial' || me.role === 'gerente';
  return (
    <>
      {canSell && (
        <section className="card">
          <h2>Pedidos entrantes</h2>
          {offers.length ? offers.map((o) => (
            <OrderRow key={o.id} o={o} t={st.t}>
              <p className="small">{o.unitPrice.toFixed(2)} €/ud · <b>{fmtEur(o.qty * o.unitPrice)}</b> · caduca en {fmtDur(o.expires - st.t)}</p>
              <div className="row"><button className="btn primary" onClick={() => act('acceptOrder', { id: o.id }, 'Pedido aceptado')}>Aceptar</button><button className="btn" onClick={() => act('rejectOrder', { id: o.id })}>Rechazar</button></div>
            </OrderRow>
          )) : <Empty>No hay pedidos nuevos.</Empty>}
        </section>
      )}
      {!canSell && offers.length > 0 && <section className="card"><p className="muted small">{offers.length} pedido(s) entrante(s) esperando respuesta del comercial.</p></section>}
      <section className="card">
        <h2>En curso</h2>
        {open.length ? open.map((o) => <OrderRow key={o.id} o={o} t={st.t} />) : <Empty>Ningún pedido abierto.</Empty>}
      </section>
      <section className="card">
        <h2>Enviados</h2>
        {recent.length ? recent.map((o) => <div key={o.id} className="kv"><span>{o.id} · {o.client}</span><b className={o.late ? 'warn' : 'ok'}>{o.late ? 'con retraso' : 'a tiempo'}</b></div>) : <Empty>—</Empty>}
      </section>
    </>
  );
}

function Incidents({ st, me, act }) {
  const [text, setText] = useState('');
  const [zone, setZone] = useState(me.zone);
  const canResolve = ['jefe', 'mantenimiento', 'gerente'].includes(me.role);
  const mine = MY_ZONES(me);
  const list = st.incidents.filter((i) => canResolve || i.userId === me.id || mine.includes(i.zone));
  const send = async () => { const r = await act('report', { text, zone }, 'Aviso enviado'); if (r.ok) setText(''); };
  return (
    <>
      <section className="card">
        <h2>Avisar de una incidencia</h2>
        <textarea rows="3" placeholder="¿Qué pasa? (p. ej. ruido en la sierra, falta material…)" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <select value={zone} onChange={(e) => setZone(e.target.value)}>{ZONE_IDS.map((z) => <option key={z} value={z}>{ZONES[z].short}</option>)}</select>
          <button className="btn primary" disabled={!text.trim()} onClick={send}>Enviar</button>
        </div>
      </section>
      <section className="card">
        <h2>Incidencias</h2>
        {list.length ? list.map((i) => (
          <div key={i.id} className="m-order">
            <div className="row"><b>{i.id}</b><Chip tone={i.status === 'ABIERTA' ? 'warn' : 'ok'}>{i.status.toLowerCase()}</Chip><span className="spacer" /><span className="muted small">{fmtClock(i.t, false)}</span></div>
            <p>{i.text}</p>
            <p className="muted small">{i.name} · {ZONES[i.zone]?.short}</p>
            {canResolve && i.status === 'ABIERTA' && <button className="btn sm" onClick={() => act('resolveIncident', { id: i.id }, 'Resuelta')}>Resolver</button>}
          </div>
        )) : <Empty>Sin incidencias.</Empty>}
      </section>
    </>
  );
}

function Profile({ st, me, act }) {
  const [pin, setPin] = useState('');
  const keys = useMemo(() => Object.entries(me.stats || {}).slice(-9).reverse(), [me.stats]);
  return (
    <>
      <section className="card">
        <h2>Mis datos</h2>
        <div className="kv"><span>Usuario</span><b>{me.username}</b></div>
        <div className="kv"><span>Función</span><b>{ROLES[me.role].name}</b></div>
        <div className="kv"><span>Turno</span><b>{SHIFTS[me.shift].name}</b></div>
        <div className="kv"><span>Zona asignada</span><b>{ZONES[me.zone]?.name}</b></div>
        <p className="muted small">El turno y la zona los asigna la administración.</p>
      </section>
      <section className="card">
        <h2>Mi producción por turno</h2>
        {keys.length ? keys.map(([k, v]) => <div key={k} className="kv"><span>{k.replace(/(\d+)([MTN])/, (_, d, s) => `Día ${d} · ${SHIFTS[s].name}`)}</span><b>{v}</b></div>) : <Empty>Todavía no hay registros.</Empty>}
      </section>
      <section className="card">
        <h2>Cambiar clave</h2>
        <div className="row"><input type="password" placeholder="Nueva clave (4–32 caracteres)" value={pin} onChange={(e) => setPin(e.target.value.slice(0, 32))} /><button className="btn" disabled={pin.length < 4} onClick={async () => { const r = await act('changePin', { pin }, 'Clave cambiada'); if (r.ok) setPin(''); }}>Guardar</button></div>
      </section>
      <div className="row center"><ConnBadge /><button className="btn ghost" onClick={() => api.logout()}>Cerrar sesión</button></div>
      <p className="muted small center">Para instalarla: menú del navegador → «Añadir a pantalla de inicio».</p>
    </>
  );
}

export { BOARDS_PER_LOG };
