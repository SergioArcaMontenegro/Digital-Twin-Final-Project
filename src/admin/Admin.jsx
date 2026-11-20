// ─────────────────────────────────────────────────────────────────────────────
// Aplicación de administración (gerencia): caja, pedidos, plan de producción, compras,
// plantilla (a dónde va cada trabajador), robots (velocidad, reparto, gemelo) y simulación.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { connect, useNet } from '../net/client.js';
import {
  PRODUCTS, PRODUCT_IDS, SPECIES, SPECIES_IDS, TONES, ROLES, SHIFTS, POSTS, COSTS, SIM_SPEEDS, LINE_STATIONS,
  fmtEur, fmtClock, fmtDur, unitPrice, BOARDS_PER_LOG,
} from '../../shared/config.js';
import { ZONES, ZONE_IDS } from '../../shared/zones.js';
import { CATEGORIES } from '../../shared/sim/economy.js';
import { T_ALARM } from '../../shared/sim/twin.js';
import { slotName } from '../../shared/sim/logistics.js';
import {
  useToast, useAct, Toast, LoginForm, Bar, Chip, productLabel, ORDER_TONE, ORDER_NAME, LineChart, Empty, ConnBadge,
} from '../ui/common.jsx';
import '../ui/apps.css';

const api = connect({ want: ['state'], app: 'admin' });

const TABS = [
  ['resumen', 'Resumen', '◧'], ['pedidos', 'Pedidos', '✉'], ['plan', 'Producción', '⚙'], ['compras', 'Compras y stock', '🪵'],
  ['plantilla', 'Plantilla', '👷'], ['robots', 'Robots y gemelo', '🦾'], ['sim', 'Simulación', '⏱'], ['registro', 'Registro', '☰'],
];

export default function Admin() {
  const user = useNet((s) => s.user);
  const st = useNet((s) => s.state);
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'resumen');
  const [msg, toast] = useToast();
  const act = useAct(api, toast);
  if (!user || user.role !== 'gerente') {
    return <LoginForm api={api} title="Administración de la planta" subtitle="Acceso de gerencia" onlyRoles={['gerente']} />;
  }
  if (!st) return <div className="loading">Cargando planta…</div>;
  const go = (t) => { setTab(t); history.replaceState(null, '', `#${t}`); };
  const pending = st.orders.filter((o) => o.status === 'OFERTA').length;
  const alerts = Object.values(st.posts).filter((p) => !p.staffed).length + Object.values(st.robots).filter((r) => r.status === 'FAULT').length;
  return (
    <div className="admin">
      <nav className="sidebar">
        <div className="brand"><div className="logo">GD</div><div><b>Planta de madera</b><span>Administración</span></div></div>
        {TABS.map(([id, name, icon]) => (
          <button key={id} className={`nav ${tab === id ? 'on' : ''}`} onClick={() => go(id)}>
            <span className="ico">{icon}</span>{name}
            {id === 'pedidos' && pending > 0 && <em className="badge">{pending}</em>}
            {id === 'resumen' && alerts > 0 && <em className="badge err">{alerts}</em>}
            {id === 'robots' && st.recommendation?.status === 'PENDIENTE' && <em className="badge">1</em>}
          </button>
        ))}
        <div className="side-foot">
          <a className="btn block" href="/" target="_blank" rel="noreferrer">Abrir visor 3D</a>
          <a className="btn block" href="/app/" target="_blank" rel="noreferrer">App móvil</a>
          <button className="btn ghost block" onClick={() => api.logout()}>Cerrar sesión</button>
        </div>
      </nav>
      <main className="main">
        <header className="mainbar">
          <h1>{TABS.find((t) => t[0] === tab)?.[1]}</h1>
          <span className="muted">{fmtClock(st.t)} · turno de {SHIFTS[st.shift].name.toLowerCase()} · {st.running ? `×${st.speed}` : 'en pausa'}</span>
          <span className="spacer" />
          <b className={st.eco.cash < 0 ? 'err' : ''}>Caja {fmtEur(st.eco.cash)}</b>
          <ConnBadge />
        </header>
        <div className="content">
          {tab === 'resumen' && <Resumen st={st} go={go} />}
          {tab === 'pedidos' && <Pedidos st={st} act={act} />}
          {tab === 'plan' && <Plan st={st} act={act} />}
          {tab === 'compras' && <Compras st={st} act={act} />}
          {tab === 'plantilla' && <Plantilla st={st} act={act} />}
          {tab === 'robots' && <Robots st={st} act={act} />}
          {tab === 'sim' && <Sim st={st} act={act} toast={toast} />}
          {tab === 'registro' && <Registro st={st} act={act} />}
        </div>
      </main>
      <Toast msg={msg} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function Kpi({ label, value, sub, tone }) {
  return <div className={`kpi ${tone || ''}`}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
}

function Resumen({ st, go }) {
  const day = Math.floor(st.t / 86400) + 1;
  const today = st.eco.today, yest = st.eco.yesterday;
  const sum = (d) => Object.values(d || {}).reduce((a, b) => a + b, 0);
  const produced = Object.entries(st.kpi.produced);
  const unstaffed = Object.values(st.posts).filter((p) => !p.staffed);
  const faults = Object.values(st.robots).filter((r) => r.status === 'FAULT');
  const myShift = st.zoneCount[st.shiftKey] || {};
  return (
    <div className="grid">
      <section className="card span2">
        <div className="kpis">
          <Kpi label="Caja" value={fmtEur(st.eco.cash)} tone={st.eco.cash < 0 ? 'err' : ''} sub={`resultado hoy ${fmtEur(sum(today))}`} />
          <Kpi label="Ventas hoy" value={fmtEur(today.venta || 0)} sub={`ayer ${fmtEur(yest.venta || 0)}`} />
          <Kpi label="Fabricado este turno" value={`${myShift.PAL || 0} uds`} sub={`troncos aserrados ${myShift.ASE || 0}`} />
          <Kpi label="Pedidos abiertos" value={st.orders.filter((o) => ['ACEPTADO', 'EN_PRODUCCION', 'LISTO'].includes(o.status)).length} sub={`${st.orders.filter((o) => o.status === 'OFERTA').length} ofertas por responder`} />
          <Kpi label="Línea" value={st.line.blocked ? 'Parada' : 'En marcha'} tone={st.line.blocked ? 'warn' : 'ok'} sub={st.line.blocked || `ciclo medio ${st.line.avgCycle ? st.line.avgCycle.toFixed(0) : '—'} s`} />
          <Kpi label="Paradas no programadas" value={st.kpi.unplanned} tone={st.kpi.unplanned ? 'err' : 'ok'} sub={`${st.kpi.simultaneous} simultáneas · ${st.kpi.maint} preventivos`} />
        </div>
      </section>
      {(unstaffed.length > 0 || faults.length > 0 || st.recommendation?.status === 'PENDIENTE') && (
        <section className="card span2 alerts">
          <h2>Atención</h2>
          {unstaffed.map((p) => <p key={p.id} className="warn">⚠ {p.name} sin personal en este turno · se detiene {p.stops}. <button className="link" onClick={() => go('plantilla')}>Asignar →</button></p>)}
          {faults.map((r) => <p key={r.id} className="err">✕ {r.id}: {r.reason}{r.repairing ? ' · reparación en curso' : ' · esperando al técnico'}</p>)}
          {st.recommendation?.status === 'PENDIENTE' && <p className="info">◆ El gemelo propone acciones para este turno. <button className="link" onClick={() => go('robots')}>Revisar →</button></p>}
        </section>
      )}
      <section className="card span2">
        <h2>Evolución de la caja</h2>
        <LineChart pts={st.eco.cashHist} fmtY={(v) => `${Math.round(v / 1000)}k`} />
      </section>
      <section className="card">
        <h2>Cuenta del día {day}</h2>
        <table className="tbl">
          <thead><tr><th>Concepto</th><th className="num">Hoy</th><th className="num">Ayer</th></tr></thead>
          <tbody>
            {Object.entries(CATEGORIES).map(([k, name]) => (today[k] || yest[k]) ? (
              <tr key={k}><td>{name}</td><td className={`num ${(today[k] || 0) < 0 ? 'err' : 'ok'}`}>{fmtEur(today[k] || 0)}</td><td className="num muted">{fmtEur(yest[k] || 0)}</td></tr>
            ) : null)}
            <tr className="total"><td>Resultado</td><td className="num">{fmtEur(sum(today))}</td><td className="num">{fmtEur(sum(yest))}</td></tr>
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Producción acumulada</h2>
        {produced.length ? produced.map(([p, n]) => (
          <div key={p} className="kv"><span>{PRODUCTS[p].icon} {PRODUCTS[p].short}</span><b>{n}</b></div>
        )) : <Empty>Todavía no ha salido nada de la línea.</Empty>}
        <h2 className="mt">Logística</h2>
        <div className="kv"><span>Troncos en patio</span><b>{Object.values(st.yard).reduce((a, b) => a + b, 0)}</b></div>
        <div className="kv"><span>Pilas en el secadero</span><b>{st.kiln.length}</b></div>
        <div className="kv"><span>Palés en almacén</span><b>{st.stock.reduce((a, s) => a + s.pallets, 0)} / 42</b></div>
        <div className="kv"><span>Camión del muelle</span><b>{st.truck.state === 'DOCKED' ? `cargando (${st.truck.pallets}/10)` : st.truck.state === 'AWAY' ? 'en ruta' : 'maniobrando'}</b></div>
      </section>
      <section className="card span2">
        <h2>Últimos eventos</h2>
        <Events list={st.events.slice(0, 12)} />
      </section>
    </div>
  );
}

function Events({ list }) {
  return <ul className="events">{list.map((e, i) => <li key={`${e.t}-${i}`} className={e.level}><time>{fmtClock(e.t)}</time><span>{e.msg}</span></li>)}</ul>;
}

// ═════════════════════════════════════════════════════════════════════════════
function dueText(t, due) {
  const d = due - t;
  return d < 0 ? <span className="err">retrasado {fmtDur(-d)}</span> : <span className={d < 3 * 3600 ? 'warn' : ''}>en {fmtDur(d)}</span>;
}

function Pedidos({ st, act }) {
  const [filter, setFilter] = useState('abiertos');
  const offers = st.orders.filter((o) => o.status === 'OFERTA');
  const open = st.orders.filter((o) => ['ACEPTADO', 'EN_PRODUCCION', 'LISTO'].includes(o.status)).sort((a, b) => a.due - b.due);
  const done = st.orders.filter((o) => ['ENVIADO', 'RECHAZADO', 'CADUCADA'].includes(o.status)).reverse();
  const backlog = st.plan.reduce((a, p) => a + Math.max(0, p.qty - p.done), 0);
  return (
    <div className="grid">
      <section className="card span2">
        <h2>Ofertas por responder <Chip tone="warn">{offers.length}</Chip></h2>
        <p className="muted small">El comercial las responde desde su app; aquí también puedes aceptarlas o rechazarlas. Carga actual de la línea: {backlog} unidades.</p>
        {offers.length ? (
          <table className="tbl">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Producto</th><th className="num">Precio</th><th className="num">Total</th><th>Entrega</th><th>Caduca</th><th /></tr></thead>
            <tbody>{offers.map((o) => (
              <tr key={o.id}>
                <td><b>{o.id}</b></td><td>{o.client}</td><td>{PRODUCTS[o.product].icon} {productLabel(o)}</td>
                <td className="num">{o.unitPrice.toFixed(2)} €</td><td className="num"><b>{fmtEur(o.qty * o.unitPrice)}</b></td>
                <td>{dueText(st.t, o.due)}</td><td className="muted">{fmtDur(o.expires - st.t)}</td>
                <td className="actions"><button className="btn primary sm" onClick={() => act('acceptOrder', { id: o.id }, `Pedido ${o.id} aceptado`)}>Aceptar</button><button className="btn sm" onClick={() => act('rejectOrder', { id: o.id })}>Rechazar</button></td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>No hay ofertas pendientes.</Empty>}
      </section>
      <section className="card span2">
        <div className="row"><h2>Pedidos</h2><span className="spacer" /><div className="seg">{['abiertos', 'cerrados'].map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>)}</div></div>
        <table className="tbl">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Producto</th><th>Estado</th><th>Avance</th><th>Entrega</th><th className="num">Importe</th></tr></thead>
          <tbody>{(filter === 'abiertos' ? open : done).map((o) => (
            <tr key={o.id}>
              <td><b>{o.id}</b></td><td>{o.client}</td><td>{PRODUCTS[o.product].icon} {productLabel(o)}</td>
              <td><Chip tone={ORDER_TONE[o.status]}>{ORDER_NAME[o.status]}</Chip>{o.late ? <Chip tone="err">con retraso</Chip> : null}</td>
              <td style={{ minWidth: 140 }}><Bar v={o.produced} max={o.qty} /><span className="muted small">{o.produced}/{o.qty} fabricadas · {o.shipped} enviadas{o.allocated ? ` · ${o.allocated} de stock` : ''}</span></td>
              <td>{o.status === 'ENVIADO' ? <span className="muted">{fmtClock(o.deliveredAt)}</span> : ['RECHAZADO', 'CADUCADA'].includes(o.status) ? '—' : dueText(st.t, o.due)}</td>
              <td className="num">{fmtEur(o.revenue || o.qty * o.unitPrice)}</td>
            </tr>
          ))}</tbody>
        </table>
        {(filter === 'abiertos' ? open : done).length === 0 && <Empty>Nada por aquí.</Empty>}
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function RouteEditor({ po, act }) {
  const P = PRODUCTS[po.product];
  return (
    <span className="route">
      {LINE_STATIONS.filter((s) => P.route.includes(s) || P.optional.includes(s)).map((s) => {
        const opt = P.optional.includes(s);
        const on = po.route.includes(s);
        return (
          <button key={s} disabled={!opt || po.status === 'HECHA'} className={`st ${on ? 'on' : ''} ${opt ? 'opt' : ''}`}
            title={opt ? (on ? `Quitar ${s} de la ruta` : `Añadir ${s} a la ruta`) : 'Obligatoria'}
            onClick={() => act('setRoute', { id: po.id, route: on ? po.route.filter((x) => x !== s) : [...po.route, s] })}>{s}</button>
        );
      })}
    </span>
  );
}

function Plan({ st, act }) {
  const [f, setF] = useState({ product: 'silla', species: 'pino', tone: 'natural', qty: 8, route: null });
  const P = PRODUCTS[f.product];
  const route = f.route || P.route;
  const boards = P.boards * f.qty;
  const active = st.plan.filter((p) => p.status !== 'HECHA' && p.status !== 'CANCELADA');
  const done = st.plan.filter((p) => p.status === 'HECHA');
  const add = async () => {
    const r = await act('addPO', { ...f, route }, 'Orden de fabricación añadida al plan');
    if (r.ok) setF({ ...f, route: null });
  };
  return (
    <div className="grid">
      <section className="card span2">
        <h2>Plan de fabricación</h2>
        <p className="muted small">La línea fabrica en este orden la primera orden para la que haya madera seca de su especie en la cepilladora. Cada orden decide a qué se destina la madera (tablones, sillas, mesas, estanterías), el acabado y por qué estaciones pasa.</p>
        <table className="tbl">
          <thead><tr><th /><th>Orden</th><th>Producto</th><th>Destino</th><th>Ruta</th><th>Acabado</th><th>Avance</th><th /></tr></thead>
          <tbody>{active.map((p, i) => (
            <tr key={p.id}>
              <td className="updown"><button className="btn sm ghost" disabled={i === 0} onClick={() => act('movePO', { id: p.id, dir: -1 })}>▲</button><button className="btn sm ghost" disabled={i === active.length - 1} onClick={() => act('movePO', { id: p.id, dir: 1 })}>▼</button></td>
              <td><b>{p.id}</b></td>
              <td>{PRODUCTS[p.product].icon} {productLabel(p)}</td>
              <td>{p.orderId ? <Chip tone="info">{p.orderId}</Chip> : <Chip>stock</Chip>}</td>
              <td><RouteEditor po={p} act={act} /></td>
              <td>{p.product === 'tablon' ? <span className="muted">—</span> : (
                <select value={p.tone} disabled={p.started > 0} onChange={(e) => act('setTone', { id: p.id, tone: e.target.value })}>
                  {Object.entries(TONES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}
                </select>
              )}</td>
              <td style={{ minWidth: 130 }}><Bar v={p.done} max={p.qty} /><span className="muted small">{p.done} hechas · {p.started - p.done} en línea · {p.qty - p.started} pendientes</span></td>
              <td>{!p.orderId && <button className="btn sm ghost" onClick={() => act('cancelPO', { id: p.id })}>Cancelar</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        {!active.length && <Empty>El plan está vacío: la línea se detendrá. Añade una orden para stock o acepta pedidos.</Empty>}
      </section>
      <section className="card">
        <h2>Nueva orden para stock</h2>
        <div className="form">
          <label>Producto<select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value, route: null, tone: 'natural' })}>{PRODUCT_IDS.map((k) => <option key={k} value={k}>{PRODUCTS[k].name}</option>)}</select></label>
          <label>Madera<select value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })}>{SPECIES_IDS.map((k) => <option key={k} value={k}>{SPECIES[k].name}</option>)}</select></label>
          {f.product !== 'tablon' && <label>Acabado<select value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })}>{Object.entries(TONES).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</select></label>}
          <label>Cantidad ({P.unit})<input type="number" min="1" max="200" value={f.qty} onChange={(e) => setF({ ...f, qty: Math.max(1, +e.target.value || 1) })} /></label>
          <div className="lbl">Ruta
            <span className="route">{LINE_STATIONS.filter((s) => P.route.includes(s) || P.optional.includes(s)).map((s) => {
              const opt = P.optional.includes(s), on = route.includes(s);
              return <button key={s} type="button" disabled={!opt} className={`st ${on ? 'on' : ''} ${opt ? 'opt' : ''}`} onClick={() => setF({ ...f, route: on ? route.filter((x) => x !== s) : LINE_STATIONS.filter((x) => route.includes(x) || x === s) })}>{s}</button>;
            })}</span>
          </div>
          <p className="muted small">Consume {boards} tablas ({Math.ceil(boards / BOARDS_PER_LOG)} troncos) · valor de venta aprox. {fmtEur(unitPrice(f.product, f.species) * f.qty)}</p>
          <button className="btn primary" onClick={add}>Añadir al plan</button>
        </div>
      </section>
      <section className="card">
        <h2>Rutas por producto</h2>
        {PRODUCT_IDS.map((k) => (
          <div key={k} className="kv"><span>{PRODUCTS[k].icon} {PRODUCTS[k].name}</span><b className="small">{PRODUCTS[k].route.join(' → ')}</b></div>
        ))}
        <p className="muted small">LIJ y BAR son opcionales: sin lijado sale más rápido; sin barniz, en acabado natural. Los tablones no pasan por el CNC ni por el ensamblaje.</p>
        <h2 className="mt">Terminadas recientemente</h2>
        {done.slice(-6).reverse().map((p) => <div key={p.id} className="kv"><span>{p.id} · {productLabel(p)}</span><b>{p.orderId || 'stock'}</b></div>)}
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function Compras({ st, act }) {
  const [buy, setBuy] = useState({ species: 'pino', logs: 12 });
  const price = st.eco.market[buy.species];
  const inTransit = st.purchases.filter((p) => p.status !== 'RECIBIDO');
  return (
    <div className="grid">
      <section className="card">
        <h2>Comprar troncos</h2>
        <div className="species">
          {SPECIES_IDS.map((k) => (
            <button key={k} className={`sp ${buy.species === k ? 'on' : ''}`} onClick={() => setBuy({ ...buy, species: k })}>
              <i style={{ background: SPECIES[k].wood }} /><b>{SPECIES[k].name}</b><span>{st.eco.market[k].toFixed(2)} €/tronco</span>
              <small className={st.eco.market[k] > SPECIES[k].log ? 'err' : 'ok'}>{st.eco.market[k] > SPECIES[k].log ? '▲' : '▼'} {Math.round((st.eco.market[k] / SPECIES[k].log - 1) * 100)} % vs. referencia</small>
            </button>
          ))}
        </div>
        <label className="lbl">Troncos: <b>{buy.logs}</b> ({buy.logs * BOARDS_PER_LOG} tablas)
          <input type="range" min="1" max="12" value={buy.logs} onChange={(e) => setBuy({ ...buy, logs: +e.target.value })} />
        </label>
        <p>Madera {fmtEur(price * buy.logs, 2)} + transporte {fmtEur(COSTS.logTransport)} = <b>{fmtEur(price * buy.logs + COSTS.logTransport, 2)}</b></p>
        <button className="btn primary" disabled={st.eco.cash < price * buy.logs + COSTS.logTransport} onClick={() => act('buyLogs', buy, 'Compra realizada · el camión está en camino')}>Comprar</button>
        <p className="muted small">Llega en 40–90 min. El aserrador da entrada al camión desde su app. Las compras automáticas están {st.settings.autoBuy ? 'activadas' : 'desactivadas'} (pestaña Simulación).</p>
      </section>
      <section className="card">
        <h2>Compras en curso</h2>
        {inTransit.length ? inTransit.map((p) => (
          <div key={p.id} className="kv"><span><b>{p.id}</b> · {p.logs} troncos de {SPECIES[p.species].name.toLowerCase()}<br /><small className="muted">{p.by}</small></span>
            <b>{p.status === 'EN_CAMINO' ? `llega en ${fmtDur(Math.max(0, p.eta - st.t))}` : p.status.toLowerCase().replace('_', ' ')}</b></div>
        )) : <Empty>No hay camiones en camino.</Empty>}
        <h2 className="mt">Patio de troncos</h2>
        {SPECIES_IDS.map((k) => <div key={k} className="kv"><span>{SPECIES[k].name}</span><span className="grow"><Bar v={st.yard[k]} max={30} /></span><b>{st.yard[k]}</b></div>)}
      </section>
      <section className="card">
        <h2>Madera en proceso</h2>
        <div className="kv"><span>Pila verde (aserradero)</span><b>{st.greenPad.layers ? `${st.greenPad.layers * BOARDS_PER_LOG} tablas de ${SPECIES[st.greenPad.species]?.name.toLowerCase()}` : 'vacía'}</b></div>
        {st.kiln.map((k, i) => <div key={i} className="kv"><span>Secadero · {SPECIES[k.species].name}</span><b className={k.left ? 'warn' : 'ok'}>{k.boards} tablas · {k.left ? `seca en ${fmtDur(k.left)}` : 'seca'}</b></div>)}
        <div className="kv"><span>Pila seca (cepilladora)</span><b>{st.dryPad.boards} tablas de {SPECIES[st.dryPad.species]?.name.toLowerCase()}</b></div>
      </section>
      <section className="card">
        <h2>Producto terminado en almacén</h2>
        <table className="tbl">
          <thead><tr><th>Referencia</th><th className="num">Palés</th><th className="num">Uds.</th><th className="num">Libres</th></tr></thead>
          <tbody>{st.stock.map((s) => (
            <tr key={`${s.product}${s.species}${s.tone}`}><td>{PRODUCTS[s.product].icon} {PRODUCTS[s.product].short} · {SPECIES[s.species].name}{s.tone !== 'natural' ? ` · ${TONES[s.tone].name}` : ''}</td><td className="num">{s.pallets}</td><td className="num">{s.units}</td><td className="num">{s.free}</td></tr>
          ))}</tbody>
        </table>
        {!st.stock.length && <Empty>Almacén vacío.</Empty>}
        <p className="muted small">Las unidades libres sirven para atender pedidos al momento (se reservan al aceptarlos).</p>
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function Plantilla({ st, act }) {
  const [shift, setShift] = useState(st.shift);
  const [nw, setNw] = useState({ name: '', username: '', role: 'mecanizado', shift: 'M', zone: '', pin: '' });
  const users = st.users.filter((u) => u.role !== 'gerente');
  const coverage = useMemo(() => {
    const out = {};
    for (const sh of ['M', 'T', 'N']) for (const p of POSTS) {
      out[`${sh}|${p.id}`] = users.filter((u) => u.active && u.role === p.role && p.zones.includes(u.zone) && (u.shift === sh || (u.shift === 'D' && sh === 'M'))).map((u) => u.name);
    }
    return out;
  }, [users]);
  const zonesFor = (role) => ZONE_IDS.filter((z) => POSTS.some((p) => p.role === role && p.zones.includes(z))).concat(['CTRL', 'MANT']).filter((v, i, a) => a.indexOf(v) === i);
  const list = users.filter((u) => shift === 'todos' || u.shift === shift || (shift === 'M' && u.shift === 'D'));
  const units = (u) => st.userStats[u.id]?.[st.shiftKey] || 0;
  const create = async () => {
    const r = await act('createWorker', nw, `Usuario «${nw.username}» creado`);
    if (r.ok) setNw({ ...nw, name: '', username: '', pin: '' });
  };
  const suggest = (name) => {
    const w = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return w.length ? `${w[0][0] || ''}${w[w.length - 1]}`.replace(/[^a-z0-9._-]/g, '') : '';
  };
  const setPass = (u) => {
    const p = prompt(`Nueva clave para ${u.name} (${u.username}) · 4 a 32 caracteres`);
    if (p !== null) act('updateWorker', { id: u.id, pin: p }, 'Clave cambiada');
  };
  const remove = (u) => { if (confirm(`¿Eliminar a ${u.name} (${u.username})? Perderá el acceso a la app.`)) act('deleteWorker', { id: u.id }, 'Usuario eliminado'); };
  return (
    <div className="grid">
      <section className="card span2">
        <div className="row"><h2>Cobertura de puestos por turno</h2><span className="spacer" />
          <label className="switch"><input type="checkbox" checked={!!st.settings.autoCrew} onChange={(e) => act('setSetting', { key: 'autoCrew', value: e.target.checked })} /><span>Cubrir huecos con personal simulado</span></label>
        </div>
        <p className="muted small">{st.settings.autoCrew ? 'Los puestos sin nadie de la plantilla los cubre un operario simulado (sin acceso a la app, cobra igual). Desactívalo para que solo trabaje la gente que des de alta: un puesto vacío parará su parte de la planta.' : 'Solo trabaja la plantilla dada de alta: un puesto vacío para su parte de la planta.'}</p>
        <table className="tbl cover">
          <thead><tr><th>Puesto</th>{['M', 'T', 'N'].map((s) => <th key={s}>{SHIFTS[s].name}{st.shift === s ? ' · ahora' : ''}</th>)}</tr></thead>
          <tbody>{POSTS.map((p) => (
            <tr key={p.id}><td><b>{p.name}</b><br /><small className="muted">si falta se detiene {p.stops}</small></td>
              {['M', 'T', 'N'].map((s) => { const who = coverage[`${s}|${p.id}`]; return <td key={s} className={who.length ? 'ok' : st.settings.autoCrew ? 'warn' : 'err'}>{who.length ? who.join(', ') : st.settings.autoCrew ? 'personal simulado' : 'SIN PERSONAL'}</td>; })}
            </tr>
          ))}</tbody>
        </table>
      </section>
      <section className="card span2">
        <div className="row"><h2>Trabajadores</h2><span className="spacer" />
          <div className="seg">{['M', 'T', 'N', 'D', 'todos'].map((s) => <button key={s} className={shift === s ? 'on' : ''} onClick={() => setShift(s)}>{s === 'todos' ? 'Todos' : SHIFTS[s].name.split(' ')[0]}</button>)}</div>
        </div>
        {!users.length && <p className="warn">Todavía no hay trabajadores: créalos en «Nuevo usuario». Cada uno entrará en la app móvil con el usuario y la clave que le pongas.</p>}
        <p className="muted small">Asigna a cada trabajador su zona y su turno: el cambio es inmediato (si sale de su puesto y nadie lo cubre, esa parte de la planta se para).</p>
        <table className="tbl">
          <thead><tr><th>Nombre</th><th>Usuario</th><th>Función</th><th>Turno</th><th>Zona asignada</th><th>Ahora</th><th className="num">Uds. turno</th><th /></tr></thead>
          <tbody>{list.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'off'}>
              <td><i className="roledot" style={{ background: ROLES[u.role].color }} /> <b>{u.name}</b></td>
              <td className="muted">{u.username}</td>
              <td>{ROLES[u.role].name}</td>
              <td><select value={u.shift} onChange={(e) => act('updateWorker', { id: u.id, shift: e.target.value })}>{Object.entries(SHIFTS).map(([k, s]) => <option key={k} value={k}>{s.name}</option>)}</select></td>
              <td><select value={u.zone} onChange={(e) => act('updateWorker', { id: u.id, zone: e.target.value })}>{ZONE_IDS.map((z) => <option key={z} value={z}>{ZONES[z].short}{zonesFor(u.role).includes(z) ? '' : ' (fuera de su puesto)'}</option>)}</select></td>
              <td>{u.present ? <Chip tone="ok">en planta</Chip> : <Chip>fuera de turno</Chip>}</td>
              <td className="num">{units(u)}</td>
              <td className="actions">
                <button className="btn sm ghost" onClick={() => act('updateWorker', { id: u.id, active: !u.active }, u.active ? 'Dado de baja' : 'Dado de alta')}>{u.active ? 'Baja' : 'Alta'}</button>
                <button className="btn sm ghost" onClick={() => setPass(u)}>Clave</button>
                <button className="btn sm ghost" onClick={() => remove(u)}>Eliminar</button>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      <section className="card">
        <h2>Nuevo usuario</h2>
        <div className="form">
          <label>Nombre y apellidos<input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value, username: !nw.username || nw.username === suggest(nw.name) ? suggest(e.target.value) : nw.username })} placeholder="p. ej. Ana Martín" /></label>
          <label>Usuario (para entrar en la app)<input value={nw.username} autoCapitalize="none" onChange={(e) => setNw({ ...nw, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} placeholder="p. ej. amartin" /></label>
          <label>Clave (4–32 caracteres)<input type="text" autoComplete="new-password" value={nw.pin} onChange={(e) => setNw({ ...nw, pin: e.target.value.slice(0, 32) })} /></label>
          <label>Función<select value={nw.role} onChange={(e) => setNw({ ...nw, role: e.target.value, zone: '' })}>{Object.entries(ROLES).filter(([k]) => k !== 'gerente').map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}</select></label>
          <label>Turno<select value={nw.shift} onChange={(e) => setNw({ ...nw, shift: e.target.value })}>{Object.entries(SHIFTS).map(([k, s]) => <option key={k} value={k}>{s.name}</option>)}</select></label>
          <label>Zona<select value={nw.zone} onChange={(e) => setNw({ ...nw, zone: e.target.value })}><option value="">La de su función</option>{zonesFor(nw.role).map((z) => <option key={z} value={z}>{ZONES[z].short}</option>)}</select></label>
          <p className="muted small">Coste: {COSTS.wage[nw.role]} €/h mientras está en turno.</p>
          <button className="btn primary" disabled={!nw.name.trim() || nw.username.length < 3 || nw.pin.length < 4} onClick={create}>Crear usuario</button>
        </div>
      </section>
      <section className="card">
        <h2>Funciones y lo que ve cada una en su app</h2>
        {Object.entries(ROLES).filter(([k]) => k !== 'gerente').map(([k, r]) => <div key={k} className="kv"><span><i className="roledot" style={{ background: r.color }} /> {r.name}</span><b className="small">{COSTS.wage[k]} €/h</b></div>)}
        <p className="muted small">Todas ven lo fabricado en su turno y los pedidos en curso. Además: el jefe aprueba las decisiones del gemelo, el técnico ejecuta las OT, el aserrador recibe camiones de troncos, logística confirma expediciones y el comercial responde ofertas.</p>
      </section>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function Robots({ st, act }) {
  const rec = st.recommendation;
  const cells = ['CNC', 'LIJ', 'ENS', 'BAR'];
  return (
    <div className="grid">
      <section className="card span2">
        <div className="row">
          <h2>Decisión de turno del gemelo</h2><span className="spacer" />
          <label className="switch"><input type="checkbox" checked={st.settings.twinEnabled} onChange={(e) => act('setSetting', { key: 'twinEnabled', value: e.target.checked })} /><span>Gemelo activo</span></label>
          <button className="btn sm" onClick={() => act('recommend', {}, 'Recomendación recalculada')}>Recalcular ahora</button>
        </div>
        {!rec ? <Empty>Se calcula 15 minutos después de cada cambio de turno.</Empty> : (
          <>
            <p><Chip tone={rec.status === 'PENDIENTE' ? 'warn' : rec.status === 'APROBADA' ? 'ok' : ''}>{rec.status}</Chip> {fmtClock(rec.at)}{rec.by ? ` · ${rec.by}` : ''}</p>
            {rec.items.length ? <ul className="recs">{rec.items.map((it, i) => <li key={i} className={it.type === 'REDUCE' ? 'reduce' : ''}><b>{it.robotId}</b> · {it.text}</li>)}</ul> : <p className="muted">Sin acciones: todos los brazos tienen margen.</p>}
            {rec.status === 'PENDIENTE' && <div className="row"><button className="btn primary" onClick={() => act('approveRec', {}, 'Recomendación aprobada · OT abiertas')}>Aprobar</button><button className="btn" onClick={() => act('rejectRec', {})}>Rechazar</button></div>}
          </>
        )}
        <p className="muted small">Con el gemelo activo se planifican paradas preventivas escalonadas (una por celda y turno) y se reducen aceleraciones cuando no hay margen. Desactívalo para ver cómo aumentan las paradas no programadas.</p>
      </section>
      <section className="card span2">
        <div className="row"><h2>Ritmo de la línea</h2><span className="spacer" /><b>takt mínimo {st.settings.pace} s</b></div>
        <input type="range" min="30" max="180" step="5" value={st.settings.pace} onChange={(e) => act('setSetting', { key: 'pace', value: +e.target.value })} />
        <p className="muted small">Takt previsto con el reparto actual: {st.evaluation.takt.toFixed(1)} s. Un takt menor produce más, pero cada brazo trabaja más tiempo por ciclo (más temperatura y desgaste).</p>
      </section>
      {cells.map((c) => (
        <section key={c} className="card">
          <h2><i className="roledot" style={{ background: ZONES[c].color }} /> {ZONES[c].name} <Chip>{st.evaluation.cells[c].mode}</Chip></h2>
          {Object.values(st.robots).filter((r) => r.cellId === c).map((r) => (
            <div key={r.id} className="robot">
              <div className="row"><b>{r.id}</b>
                <Chip tone={r.status === 'FAULT' ? 'err' : r.status === 'MAINT' ? 'info' : r.temp > T_ALARM - 10 ? 'warn' : 'ok'}>{r.status === 'FAULT' ? 'avería' : r.status === 'MAINT' ? 'mantenimiento' : 'en marcha'}</Chip>
                <span className="spacer" /><span className="muted small">{r.temp.toFixed(0)} °C · RUL {r.rul > 9999 ? '>9999' : r.rul} h · ciclo {Math.round(r.duty * 100)} %</span>
              </div>
              <div className="kv"><span>Desgaste</span><span className="grow"><Bar v={r.wear} tone={r.wear > 0.85 ? 'err' : r.wear > 0.6 ? 'warn' : ''} /></span><b>{Math.round(r.wear * 100)} %</b></div>
              <label className="lbl">Velocidad {Math.round(r.speed * 100)} %{r.accelF < 1 ? ' (acel. reducida por el gemelo)' : ''}
                <input type="range" min="50" max="130" step="5" value={Math.round(r.speed * 100)} onChange={(e) => act('setRobot', { robotId: r.id, speed: +e.target.value / 100 })} />
              </label>
              <label className="lbl">Reparto de carga {r.share.toFixed(1)} {r.share === 0 ? '(sin trabajo)' : ''}
                <input type="range" min="0" max="2" step="0.1" value={r.share} onChange={(e) => act('setRobot', { robotId: r.id, share: +e.target.value })} />
              </label>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
function Sim({ st, act, toast }) {
  const mode = useNet((s) => s.mode);
  const S = st.settings;
  const sw = (key, label, hint) => (
    <div className="setting">
      <label className="switch"><input type="checkbox" checked={!!S[key]} onChange={(e) => act('setSetting', { key, value: e.target.checked })} /><span>{label}</span></label>
      <p className="muted small">{hint}</p>
    </div>
  );
  const appUrl = `${location.origin}/app/`;
  return (
    <div className="grid">
      <section className="card">
        <h2>Reloj</h2>
        <p className="big">{fmtClock(st.t)}</p>
        <div className="row">
          <button className="btn" onClick={() => act('setRunning', { running: !st.running })}>{st.running ? '❚❚ Pausa' : '▶ Continuar'}</button>
          <div className="seg">{SIM_SPEEDS.map((s) => <button key={s} className={st.speed === s ? 'on' : ''} onClick={() => act('setSimSpeed', { speed: s })}>×{s}</button>)}</div>
        </div>
        <p className="muted small">×60 = un minuto de planta por segundo; ×600 = un turno en 48 s.</p>
      </section>
      <section className="card">
        <h2>Automatismos</h2>
        {sw('autoCrew', 'Personal simulado en puestos vacíos', 'Cubre los puestos sin nadie de la plantilla para que la planta no se pare.')}
        {sw('autoWorkers', 'Trabajadores simulados', 'Si nadie responde desde la app, el trabajador del turno hace su tarea pasados unos minutos.')}
        {sw('autoSales', 'Comercial simulado', 'Acepta los pedidos con plazo razonable y rechaza los imposibles.')}
        {sw('autoBuy', 'Compras automáticas de troncos', 'Compra según el plan y mantiene un colchón en el patio.')}
        {sw('autoStock', 'Fabricar para stock', 'Si el plan se queda sin trabajo, lanza órdenes de las referencias más vendidas.')}
      </section>
      <section className="card">
        <h2>Proceso</h2>
        <label className="lbl">Secado por pila: {Math.round(S.kilnTime / 60)} min<input type="range" min="10" max="240" step="5" value={Math.round(S.kilnTime / 60)} onChange={(e) => act('setSetting', { key: 'kilnTime', value: +e.target.value * 60 })} /></label>
        <label className="lbl">Cepillado por unidad: {S.cepTime} s<input type="range" min="10" max="90" value={S.cepTime} onChange={(e) => act('setSetting', { key: 'cepTime', value: +e.target.value })} /></label>
      </section>
      <section className="card">
        <h2>Conexión</h2>
        <p>{mode === 'local' ? 'Sin servidor: esta simulación corre solo en este navegador.' : 'Servidor en línea: todas las pantallas comparten la misma planta.'}</p>
        <p className="small">App móvil para los operarios: <a href="/app/" target="_blank" rel="noreferrer">{appUrl}</a></p>
        <p className="muted small">Los operarios entran con el usuario y la clave que les crees en Plantilla; cada uno ve su función.</p>
        <button className="btn danger" onClick={async () => { if (!confirm('¿Reiniciar la simulación? Se conserva la plantilla.')) return; const r = await api.reset(); toast(r.ok ? { text: 'Simulación reiniciada' } : { err: true, text: r.error }); }}>Reiniciar simulación</button>
      </section>
    </div>
  );
}

function Registro({ st, act }) {
  const inc = st.incidents;
  return (
    <div className="grid">
      <section className="card">
        <h2>Incidencias de los operarios</h2>
        {inc.length ? inc.map((i) => (
          <div key={i.id} className={`incident ${i.status === 'ABIERTA' ? 'open' : ''}`}>
            <div className="row"><b>{i.id}</b><Chip tone={i.status === 'ABIERTA' ? 'warn' : 'ok'}>{i.status.toLowerCase()}</Chip><span className="spacer" /><span className="muted small">{fmtClock(i.t)}</span></div>
            <p>{i.text}</p>
            <p className="muted small">{i.name} · {ROLES[i.role]?.name} · {ZONES[i.zone]?.short}{i.resolvedBy ? ` · resuelta por ${i.resolvedBy}` : ''}</p>
            {i.status === 'ABIERTA' && <button className="btn sm" onClick={() => act('resolveIncident', { id: i.id })}>Marcar como resuelta</button>}
          </div>
        )) : <Empty>Sin incidencias.</Empty>}
      </section>
      <section className="card">
        <h2>Registro de la planta</h2>
        <Events list={st.events} />
      </section>
      <section className="card span2">
        <h2>Movimientos de caja</h2>
        <table className="tbl">
          <thead><tr><th>Hora</th><th>Concepto</th><th>Detalle</th><th className="num">Importe</th></tr></thead>
          <tbody>{st.eco.ledger.slice(0, 40).map((l, i) => <tr key={i}><td className="muted">{fmtClock(l.t)}</td><td>{CATEGORIES[l.cat]}</td><td>{l.desc}</td><td className={`num ${l.amount < 0 ? 'err' : 'ok'}`}>{fmtEur(l.amount, 2)}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}

export { slotName };
