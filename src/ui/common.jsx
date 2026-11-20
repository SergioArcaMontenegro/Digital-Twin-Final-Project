// Componentes compartidos por la administración y la app móvil.
import { useEffect, useState, useCallback } from 'react';
import { useNet } from '../net/client.js';
import { PRODUCTS, SPECIES, TONES, ROLES } from '../../shared/config.js';

export function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(null), 3200); return () => clearTimeout(t); }, [msg]);
  return [msg, setMsg];
}

/** Envía una acción y muestra el resultado. */
export function useAct(api, toast) {
  return useCallback(async (action, payload, okMsg) => {
    const r = await api.action(action, payload);
    if (!r.ok) toast?.({ err: true, text: r.error || 'No se ha podido hacer' });
    else if (okMsg) toast?.({ text: okMsg });
    return r;
  }, [api, toast]);
}

export function Toast({ msg }) {
  if (!msg) return null;
  return <div className={`toast ${msg.err ? 'is-err' : ''}`}>{msg.text || msg}</div>;
}

export function LoginForm({ api, title, subtitle, hint, onlyRoles }) {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const mode = useNet((s) => s.mode);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const r = await api.login(u.trim(), p);
    setBusy(false);
    if (!r.ok) { setErr(r.error || 'No se pudo iniciar sesión'); return; }
    if (onlyRoles && !onlyRoles.includes(r.user.role)) { api.logout(); setErr(`Esta aplicación es para ${onlyRoles.map((x) => ROLES[x].name.toLowerCase()).join(' / ')}. Usa la app móvil.`); }
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="logo big">GD</div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        <label>Usuario<input autoCapitalize="none" autoCorrect="off" value={u} onChange={(e) => setU(e.target.value)} autoFocus /></label>
        <label>Clave<input type="password" value={p} onChange={(e) => setP(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary block" disabled={busy || !u || !p}>Entrar</button>
        {hint && <p className="muted small">{hint}</p>}
        <p className="muted small">{mode === 'local' ? 'Sin servidor: simulación local en este dispositivo.' : mode ? 'Conectado a la planta.' : 'Conectando…'}</p>
      </form>
    </div>
  );
}

export function Bar({ v, max = 1, tone }) {
  const k = Math.max(0, Math.min(1, max ? v / max : 0));
  return <span className={`bar ${tone || ''}`}><i style={{ width: `${k * 100}%` }} /></span>;
}

export function Chip({ tone, children }) { return <span className={`chip ${tone || ''}`}>{children}</span>; }

export const productLabel = (o) => `${o.qty ?? ''} ${PRODUCTS[o.product]?.unit || ''} de ${SPECIES[o.species]?.name.toLowerCase() || ''}${o.tone && o.tone !== 'natural' ? ` · ${TONES[o.tone]?.name.toLowerCase()}` : ''}`.trim();

export const ORDER_TONE = { OFERTA: 'warn', ACEPTADO: 'info', EN_PRODUCCION: 'info', LISTO: 'ok', ENVIADO: 'ok', RECHAZADO: '', CADUCADA: 'err' };
export const ORDER_NAME = { OFERTA: 'Oferta', ACEPTADO: 'Aceptado', EN_PRODUCCION: 'En producción', LISTO: 'Listo para enviar', ENVIADO: 'Enviado', RECHAZADO: 'Rechazado', CADUCADA: 'Caducada' };

/** Gráfico de línea SVG sencillo. pts = [[x, y], …] */
export function LineChart({ pts, height = 140, color = '#39c0ff', fmtY = (v) => v, zero = false }) {
  if (!pts || pts.length < 2) return <div className="chart empty muted small">Aún no hay datos suficientes</div>;
  const W = 600, H = height, pad = 26;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (zero) y0 = Math.min(0, y0);
  if (y1 - y0 < 1) { y1 += 1; y0 -= 1; }
  const X = (x) => pad + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - pad - 6);
  const Y = (y) => H - 18 - ((y - y0) / (y1 - y0)) * (H - 30);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const area = `${d} L${X(x1)},${H - 18} L${X(x0)},${H - 18} Z`;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      <defs><linearGradient id="g1" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.35" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((k) => { const y = y0 + (y1 - y0) * k; return <g key={k}><line x1={pad} x2={W - 6} y1={Y(y)} y2={Y(y)} className="gl" /><text x={2} y={Y(y) + 4} className="axis">{fmtY(y)}</text></g>; })}
      <path d={area} fill="url(#g1)" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Empty({ children }) { return <p className="empty muted">{children}</p>; }

export function ConnBadge() {
  const mode = useNet((s) => s.mode), status = useNet((s) => s.status);
  return <span className={`conn ${status === 'conectado' ? 'ok' : 'warn'}`}>{mode === 'local' ? 'Local' : status === 'conectado' ? 'En línea' : 'Reconectando…'}</span>;
}
