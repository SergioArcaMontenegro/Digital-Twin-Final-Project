import { useState } from 'react';
import { useTwinStore } from '../store/useTwinStore';
import { engine, fmtClock, shiftName, T_ALARM, T_TRIP, MAINT_MIN, ACCEL_REDUCED } from '../sim/engine';
import { TAKT_TARGET, ROBOTS } from '../sim/layout';
import { ROBOT_SPECS, ROBOT_MODELS, TOOL_SPECS } from '../robots/robotSpecs';

const SPEEDS = [1, 10, 60, 600, 3600];
const AGV_STATE = { MOVING: 'En ruta', WAIT: 'Cede el paso', ACTION: 'Maniobra', IDLE: 'En base' };
const VIEW_BTNS = [['overview', 'General'], ['saw', 'Aserradero'], ['kiln', 'Secadero'], ['cnc', 'CNC · Lijado'], ['ens', 'Ensamblaje · Barniz'], ['pal', 'Paletizado'], ['store', 'Almacén · Muelle'], ['control', 'Control']];
const STATUS_TXT = { RUN: 'En marcha', MAINT: 'Mantenimiento', FAULT: 'Avería' };
const modeCls = (m) => (m === 'REPARTO' ? 'ok' : m === 'MONOBRAZO' ? 'info' : m === 'PARADA' ? 'err' : 'warn');

const hrs = (s) => (s / 3600).toFixed(1);
const fmtRul = (h) => (h > 9999 ? '>9999' : h.toFixed(0));
const tempCls = (t) => (t >= T_ALARM ? 'err' : t >= T_ALARM - 12 ? 'warn' : 'ok');
const defOf = (id) => ROBOTS.find((r) => r.id === id);

// ─────────────────────────────────────────────────────────────────────────────
function TopBar() {
  const snap = useTwinStore((s) => s.snap);
  const act = useTwinStore((s) => s.act);
  const showLabels = useTwinStore((s) => s.showLabels);
  const toggleLabels = useTwinStore((s) => s.toggleLabels);
  const toShift = Math.max(0, snap.nextShift - snap.simTime);
  return (
    <header className="topbar panel">
      <div className="brand">
        <div className="logo">DT</div>
        <div>
          <h1>Gemelo Digital · Celdas Robóticas</h1>
          <p>Planta de madera · 9 brazos · paletizador · 2 pórticos · 4 AGVs</p>
        </div>
      </div>
      <div className="clock">
        <b>{fmtClock(snap.simTime)}</b>
        <span>{shiftName(snap.simTime)} · cambio en {Math.floor(toShift / 3600)} h {Math.floor((toShift % 3600) / 60)} min</span>
      </div>
      <div className="group">
        <button className={`btn icon ${snap.running ? '' : 'on'}`} title={snap.running ? 'Pausar' : 'Reanudar'}
          onClick={() => act((e) => { e.running = !e.running; })}>{snap.running ? '❚❚' : '▶'}</button>
        <div className="seg" role="group" aria-label="Velocidad de simulación">
          {SPEEDS.map((v) => (
            <button key={v} className={snap.speed === v ? 'on' : ''} onClick={() => act((e) => { e.speed = v; })}>
              {v === 3600 ? '1 h/s' : `${v}×`}
            </button>
          ))}
        </div>
      </div>
      <div className="group">
        <label className="switch" title="Con el gemelo desactivado no hay recomendaciones de turno (situación de partida)">
          <input type="checkbox" checked={snap.twinEnabled} onChange={() => act((e) => { e.twinEnabled = !e.twinEnabled; })} />
          <span>Gemelo</span>
        </label>
        <label className="switch" title="Aprueba automáticamente las recomendaciones (modo demostración)">
          <input type="checkbox" checked={snap.autoApprove} onChange={() => act((e) => { e.autoApprove = !e.autoApprove; })} />
          <span>Auto-aprobar</span>
        </label>
        <label className="switch">
          <input type="checkbox" checked={showLabels} onChange={toggleLabels} />
          <span>Etiquetas</span>
        </label>
        <button className="btn ghost" onClick={() => act((e) => e.reset())} title="Reiniciar la simulación">Reiniciar</button>
      </div>
    </header>
  );
}

function ViewBar() {
  const setFocus = useTwinStore((s) => s.setFocus);
  return (
    <nav className="viewbar panel seg" aria-label="Vistas de cámara">
      {VIEW_BTNS.map(([k, t]) => <button key={k} onClick={() => setFocus(k)}>{t}</button>)}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Kpis() {
  const snap = useTwinStore((s) => s.snap);
  const k = snap.kpi;
  const taktOk = snap.takt <= TAKT_TARGET + 0.01;
  const items = [
    ['Takt', `${snap.takt.toFixed(1)} s`, `objetivo ${TAKT_TARGET} s`, snap.lineStopped ? 'err' : taktOk ? 'ok' : 'warn'],
    ['Producidas', Math.floor(k.produced).toLocaleString('es-ES'), 'módulos de mueble', ''],
    ['Paradas no prog.', k.unplanned, 'averías de brazo', k.unplanned ? 'err' : 'ok'],
    ['Simultáneas', k.simultaneous, 'misma celda · objetivo 0', k.simultaneous ? 'err' : 'ok'],
    ['Línea parada', k.lineStops, `${hrs(k.lineDown)} h perdidas`, k.lineStops ? 'err' : 'ok'],
    ['Marcha continua', `${hrs(k.run)} h`, `récord ${hrs(k.longestRun)} h`, ''],
    ['Preventivos', k.maint, `escalonados · ${MAINT_MIN} min`, ''],
  ];
  return (
    <section>
      <h2>Indicadores {snap.lineStopped && <span className="chip err pulse">LÍNEA PARADA</span>}</h2>
      <div className="kpis">
        {items.map(([t, v, s, c]) => (
          <div key={t} className={`kpi ${c}`}><span>{t}</span><b>{v}</b><small>{s}</small></div>
        ))}
      </div>
      <p className="goal">Éxito: −40 % paradas no programadas/año · 0 paradas simultáneas por celda · +18 % vida útil de servomotores</p>
    </section>
  );
}

function Recommendation() {
  const snap = useTwinStore((s) => s.snap);
  const act = useTwinStore((s) => s.act);
  const selectRobot = useTwinStore((s) => s.selectRobot);
  const rec = snap.recommendation;
  return (
    <section>
      <h2>
        Decisión de turno
        {rec && <span className={`chip ${rec.status === 'PENDIENTE' ? 'warn' : rec.status === 'APROBADA' ? 'ok' : ''}`}>{rec.status}</span>}
      </h2>
      {!snap.twinEnabled && <p className="muted">Gemelo desactivado: sin recomendaciones (situación de partida, desgaste idéntico).</p>}
      {snap.twinEnabled && !rec && <p className="muted">El gemelo propondrá el reparto y el mantenimiento en el próximo cambio de turno.</p>}
      {rec && (
        <>
          <p className="muted small">Generada {fmtClock(rec.at)} · recomendada por el gemelo, aprobada por el responsable, ejecutada por el PLC.</p>
          {rec.items.length === 0 && <p className="muted">Sin acciones: todos los brazos con margen suficiente.</p>}
          <ul className="recs">
            {rec.items.map((it, i) => (
              <li key={i} className={it.type === 'MAINT' ? 'maint' : 'reduce'} onClick={() => selectRobot(it.robotId)}>
                <b>{it.type === 'MAINT' ? '🔧' : '⏬'} {it.robotId}{it.ot ? ` · ${it.ot}` : ''}</b>
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
          {rec.status === 'PENDIENTE' && (
            <div className="row">
              <button className="btn primary" onClick={() => act((e) => e.approve())}>Aprobar y enviar al PLC</button>
              <button className="btn ghost" onClick={() => act((e) => e.reject())}>Rechazar</button>
            </div>
          )}
        </>
      )}
      {snap.twinEnabled && (
        <button className="btn ghost small" onClick={() => act((e) => e.forceShift())}>Calcular recomendación ahora</button>
      )}
    </section>
  );
}

function Events() {
  const events = useTwinStore((s) => s.snap.events);
  return (
    <section className="grow">
      <h2>Eventos</h2>
      <ul className="events">
        {events.map((e, i) => (
          <li key={`${e.t}-${i}`} className={e.level}>
            <time>{fmtClock(e.t).replace('Día ', 'D')}</time><span>{e.msg}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Cells({ cells }) {
  const snap = useTwinStore((s) => s.snap);
  const act = useTwinStore((s) => s.act);
  const selected = useTwinStore((s) => s.selectedRobot);
  const selectRobot = useTwinStore((s) => s.selectRobot);
  const setFocus = useTwinStore((s) => s.setFocus);
  return (
    <section className="cells">
      <h2>Celdas redundantes</h2>
      {cells.map((cell) => {
        const c = snap.cells[cell.id];
        const rs = snap.robots.filter((r) => r.cellId === cell.id);
        return (
          <div key={cell.id} className="cell" style={{ '--cell': cell.color }}>
            <div className="cell-head">
              <button className="link" onClick={() => setFocus(cell.id === 'CNC' || cell.id === 'LIJ' ? 'cnc' : 'ens')}><b>{cell.id} · {cell.short}</b></button>
              <span className={`chip ${modeCls(c.mode)}`}>{c.mode}</span>
              <span className="muted small right">ciclo {c.cycle.toFixed(1)} s</span>
            </div>
            <div className="bar"><i style={{ width: `${Math.min(100, (c.cycle / (TAKT_TARGET - 6)) * 100)}%` }} className={c.cycle > TAKT_TARGET - 6 ? 'err' : ''} /></div>
            <table>
              <tbody>
                {rs.map((r) => (
                  <tr key={r.id} className={selected === r.id ? 'sel' : ''} onClick={() => selectRobot(r.id)}>
                    <td><i className={`dot ${r.status}`} /> {r.id}</td>
                    <td className={tempCls(r.temp)}>{r.temp.toFixed(0)} °C</td>
                    <td>{Math.round(r.shareNorm * 100)} %</td>
                    <td title="Vida útil restante">{fmtRul(r.rul)} h</td>
                    <td className="wear"><span style={{ width: `${Math.min(100, r.wear * 100)}%` }} className={r.wear > 0.8 ? 'err' : r.wear > 0.6 ? 'warn' : ''} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row small">
              <button className="btn ghost small" onClick={() => act((e) => e.balanceByHealth(cell.id))}>Reparto por salud</button>
              <button className="btn ghost small" onClick={() => act((e) => e.resetShares(cell.id))}>Igualar</button>
            </div>
          </div>
        );
      })}
      <p className="legend small muted">Columnas: estado · temperatura bobinado · carga asignada · RUL · desgaste</p>
    </section>
  );
}

function Logistics() {
  const L = useTwinStore((s) => s.snap.logistics);
  const row = (k, v, cls = '') => <div className="lrow"><span>{k}</span><b className={cls}>{v}</b></div>;
  return (
    <section className="logi">
      <h2>Logística coordinada</h2>
      <div className="lgrid">
        {row('Patio de troncos', `${L.yardLogs} troncos`)}
        {row('Pórtico de troncos', L.logGantry)}
        {row('Sierra de cinta', L.saw)}
        {row('Pórtico apilador', L.stacker)}
        {row('Pila verde', `${L.sawPad}/6 capas`, L.sawPad >= 6 ? 'warn' : '')}
        {row('Secadero', `${L.kilnLoads}/4 · ${L.kilnOut} listas`)}
        {row('Pila seca (cepilladora)', `${L.planerPad}/6 capas`, L.planerPad <= 1 ? 'warn' : '')}
        {row('Paletizador', `${L.palletizer} · ${L.palletItems}/4`)}
        {row('Almacén', `${L.rackFilled}/${L.rackTotal} huecos`)}
        {row('Camión (muelle 1)', L.truck === 'DOCKED' ? `${L.truckLoad}/${L.truckCap} palés` : L.truck === 'AWAY' ? 'En ruta' : 'Maniobrando', L.truck === 'DOCKED' ? '' : 'info')}
      </div>
      <table className="agvs">
        <tbody>
          {L.agvs.map((a) => (
            <tr key={a.id} className={a.state}>
              <td><i className={`dot agv-${a.state}`} /> <b>{a.id}</b><small>{a.type === 'fork' ? 'carretilla' : 'elevación'}</small></td>
              <td>{a.state === 'WAIT' ? <span className="warn">{a.wait}</span> : a.mission}</td>
              <td className="bat"><span style={{ width: `${a.battery}%` }} className={a.battery < 30 ? 'err' : ''} /><small>{a.battery.toFixed(0)} %</small></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">Carriles de sentido único; cada cruce se concede a un solo AGV (reserva de nodos). Palés expedidos: {L.counters.shipped} · camiones: {L.counters.trucks}</p>
    </section>
  );
}

function Sparkline({ hist }) {
  if (hist.length < 2) return <div className="spark muted small">Recogiendo histórico…</div>;
  const W = 300, H = 70;
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0] || t0 + 1;
  const xs = (t) => ((t - t0) / (t1 - t0 || 1)) * W;
  const yT = (v) => H - ((v - 20) / (T_TRIP - 20)) * H;
  const yW = (v) => H - v * H;
  const path = (f) => hist.map((h, i) => `${i ? 'L' : 'M'}${xs(h[0]).toFixed(1)},${f(h).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={yT(T_ALARM)} y2={yT(T_ALARM)} className="alarm" />
      <path d={path((h) => yW(h[2]))} className="wear" />
      <path d={path((h) => yT(h[1]))} className="temp" />
    </svg>
  );
}

function RobotDetail({ id }) {
  const snap = useTwinStore((s) => s.snap);
  const act = useTwinStore((s) => s.act);
  const selectRobot = useTwinStore((s) => s.selectRobot);
  const [tab, setTab] = useState('tele');
  const r = snap.robots.find((x) => x.id === id);
  if (!r) return null;
  const def = defOf(id);
  const m = ROBOT_MODELS[def.model];
  const wiStop = engine.whatIfStop(id, MAINT_MIN);
  const wiStopRed = wiStop.ok ? null : engine.whatIfStop(id, MAINT_MIN, ACCEL_REDUCED);
  const wiAcc = engine.whatIfAccel(id, ACCEL_REDUCED, 16);
  const err = r.measured - r.temp;
  const left = r.until - snap.simTime;

  return (
    <div className="detail panel">
      <div className="detail-head">
        <div>
          <h3><i className={`dot ${r.status}`} /> {id} <span className="muted">· {STATUS_TXT[r.status]}</span></h3>
          <p className="muted small">{ROBOT_SPECS[m.spec].model} · {TOOL_SPECS[m.tool].label}</p>
          {r.status !== 'RUN' && <p className={`small ${r.status === 'FAULT' ? 'err' : 'info'}`}>{r.reason} · {Math.max(0, left / 60).toFixed(0)} min restantes</p>}
          {r.accelUntil > 0 && <p className="small warn">Aceleración ejes 2-3 al {(r.accel * 100).toFixed(0)} % · {hrs(r.accelUntil - snap.simTime)} h</p>}
        </div>
        <button className="btn icon ghost" onClick={() => selectRobot(null)} aria-label="Cerrar">✕</button>
      </div>
      <div className="seg tabs">
        <button className={tab === 'tele' ? 'on' : ''} onClick={() => setTab('tele')}>Telemetría</button>
        <button className={tab === 'what' ? 'on' : ''} onClick={() => setTab('what')}>¿Qué pasaría si…?</button>
        <button className={tab === 'ctl' ? 'on' : ''} onClick={() => setTab('ctl')}>Control</button>
      </div>

      {tab === 'tele' && (
        <>
          <div className="tele">
            <div><span>T bobinado (modelo)</span><b className={tempCls(r.temp)}>{r.temp.toFixed(1)} °C</b></div>
            <div><span>T medida PT100/KTY</span><b>{r.measured.toFixed(1)} °C</b></div>
            <div><span>Error de validación</span><b className={Math.abs(err) <= 4 ? 'ok' : 'err'}>{err >= 0 ? '+' : ''}{err.toFixed(1)} °C {Math.abs(err) <= 4 ? '✓' : '✗'}</b></div>
            <div><span>Corriente rms</span><b>{r.current.toFixed(1)} A</b></div>
            <div><span>Integral I²t</span><b>{r.i2t.toFixed(0)} A²·h</b></div>
            <div><span>R<sub>th</sub> calibrada</span><b>{r.rthEst.toFixed(3)} K/W</b></div>
            <div><span>Ciclo de trabajo</span><b>{(r.duty * 100).toFixed(0)} %</b></div>
            <div><span>Desgaste acumulado</span><b className={r.wear > 0.8 ? 'err' : r.wear > 0.6 ? 'warn' : ''}>{(r.wear * 100).toFixed(1)} %</b></div>
            <div><span>Vida útil restante</span><b>{fmtRul(r.rul)} h</b></div>
            <div><span>Ciclos completados</span><b>{Math.floor(r.cycles).toLocaleString('es-ES')}</b></div>
          </div>
          <Sparkline hist={r.hist} />
          <p className="legend small muted"><i className="lg temp" /> temperatura (línea roja: alarma {T_ALARM} °C) <i className="lg wear" /> desgaste</p>
        </>
      )}

      {tab === 'what' && (
        <div className="whatif">
          <div className={`wi ${wiStop.ok ? 'wi-ok' : 'wi-err'}`}>
            <h4>¿Si {id} para {MAINT_MIN} min por mantenimiento?</h4>
            <p>Modo resultante: <b>{wiStop.mode}</b> · takt {wiStop.takt.toFixed(1)} s {wiStop.taktOk ? '✓' : '✗'}</p>
            {wiStop.others.map((o) => (
              <p key={o.id} className="small">{o.id} asume {Math.round(o.share * 100)} % · régimen {o.tss.toFixed(0)} °C · pico a los {MAINT_MIN} min <b className={tempCls(o.peak)}>{o.peak.toFixed(0)} °C</b></p>
            ))}
            <p className={`verdict ${wiStop.ok ? 'ok' : 'err'}`}>{wiStop.ok ? 'Viable: margen térmico y takt cumplidos.' : 'No viable con el perfil actual.'}</p>
            {wiStopRed && (
              <p className="small">Con aceleración −12 % en el resto: pico {wiStopRed.peak.toFixed(0)} °C · takt {wiStopRed.takt.toFixed(1)} s → <b className={wiStopRed.ok ? 'ok' : 'err'}>{wiStopRed.ok ? 'viable' : 'no viable'}</b></p>
            )}
          </div>
          <div className={`wi ${wiAcc.taktOk ? 'wi-ok' : 'wi-warn'}`}>
            <h4>¿Si reducimos la aceleración de los ejes 2 y 3 un 12 % durante 16 h?</h4>
            <p>Temperatura en régimen {wiAcc.T0.toFixed(0)} → <b>{wiAcc.T1.toFixed(0)} °C</b> · takt {wiAcc.takt.toFixed(1)} s {wiAcc.taktOk ? '✓' : '✗'}</p>
            <p>RUL {fmtRul(wiAcc.rul0)} → <b>{fmtRul(wiAcc.rul1)} h</b> · <b className="ok">+{wiAcc.gain.toFixed(0)} h</b> para posponer la intervención</p>
          </div>
        </div>
      )}

      {tab === 'ctl' && (
        <div className="ctl">
          <label className="slider">
            <span>Peso de reparto de carga <b>{Math.round(r.share * 100)} %</b> → carga real {Math.round(r.shareNorm * 100)} %</span>
            <input type="range" min="0" max="100" value={Math.round(r.share * 100)}
              onChange={(ev) => act((e) => e.setShare(id, ev.target.value / 100))} />
          </label>
          <div className="row">
            <button className="btn primary" disabled={r.status !== 'RUN'} onClick={() => act((e) => e.startMaintenance(id))}>Mantenimiento {MAINT_MIN} min</button>
            {r.accel < 1
              ? <button className="btn ghost" onClick={() => act((e) => e.setAccel(id, 1))}>Restaurar aceleración</button>
              : <button className="btn ghost" onClick={() => act((e) => e.setAccel(id, ACCEL_REDUCED, 16))}>Aceleración −12 % · 16 h</button>}
          </div>
          <p className="small muted">El técnico autoriza la parada en la HMI y el PLC reasigna el trabajo al resto de brazos de la celda.</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function TwinPanel({ cells }) {
  const selected = useTwinStore((s) => s.selectedRobot);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  return (
    <div className="hud">
      <TopBar />
      <ViewBar />
      <aside className={`side left panel ${left ? '' : 'collapsed'}`}>
        <button className="collapse" onClick={() => setLeft(!left)} aria-label="Plegar panel">{left ? '‹' : '›'}</button>
        {left && <><Kpis /><Recommendation /><Events /></>}
      </aside>
      <aside className={`side right panel ${right ? '' : 'collapsed'}`}>
        <button className="collapse" onClick={() => setRight(!right)} aria-label="Plegar panel">{right ? '›' : '‹'}</button>
        {right && <><Cells cells={cells} /><Logistics /></>}
      </aside>
      {selected && <RobotDetail id={selected} />}
    </div>
  );
}
