import React, { useState } from 'react';
import { useFactoryStore, STATIONS } from '../store/useFactoryStore';

// Robot names and roles
const ROBOT_NAMES = [
  { name: 'Brazo Soldador',     emoji: '🔥', role: 'Soldadura estructural',     color: '#ff6b35' },
  { name: 'Brazo Ensamblador',  emoji: '🔧', role: 'Montaje superior',          color: '#4ecdc4' },
  { name: 'Brazo Lateral',      emoji: '⚙️',  role: 'Componentes laterales',     color: '#45b7d1' },
  { name: 'Brazo Pintor',       emoji: '🎨', role: 'Aplicación de pintura',      color: '#c0392b' },
  { name: 'Brazo Acabador',     emoji: '✨', role: 'Acabado y pulido',           color: '#e74c3c' },
  { name: 'Brazo Inspector',    emoji: '🔍', role: 'Inspección de calidad',      color: '#27ae60' },
];

// Phase pipeline steps
const PHASES = [
  { label: 'Chasis Base',         icon: '▭',  color: '#7a7a7a' },
  { label: 'Estructura Sup.',     icon: '⬒',  color: '#5577aa' },
  { label: 'Componentes Lat.',    icon: '⊞',  color: '#3a7a9a' },
  { label: 'Pintura',             icon: '◉',  color: '#c0392b' },
  { label: 'Acabado Final',       icon: '◈',  color: '#e74c3c' },
  { label: 'Insp. ✓',            icon: '✔',  color: '#27ae60' },
];

const STATE_COLORS = {
  IDLE: '#555', REACHING: '#3399ff', GRIPPING: '#ff9900',
  LIFTING: '#ffcc00', WORKING: '#ff4444', LOWERING: '#ff9900',
  RELEASING: '#ff9900', RETRACTING: '#3399ff',
};

// Simple SVG arm schematic for each robot
function RobotArmIcon({ color, state }) {
  const active = state !== 'IDLE';
  return (
    <svg width="70" height="80" viewBox="0 0 70 80" style={{ flexShrink: 0 }}>
      {/* Base */}
      <rect x="26" y="68" width="18" height="8" rx="3" fill="#333" />
      <rect x="29" y="62" width="12" height="8" rx="2" fill="#444" />
      {/* Body */}
      <rect x="27" y="46" width="16" height="18" rx="4" fill={color} opacity="0.9" />
      {/* Upper arm */}
      <rect x="31" y="28" width="8" height="20" rx="3"
        fill={color}
        transform={active ? 'rotate(-15 35 46)' : ''}
        style={{ transition: 'transform 0.6s ease' }} />
      {/* Elbow joint */}
      <circle cx="35" cy="28" r="5" fill="#333" />
      {/* Forearm */}
      <rect x="34" y="10" width="6" height="20" rx="3"
        fill={color} opacity="0.85"
        transform={active ? 'rotate(20 35 28)' : ''}
        style={{ transition: 'transform 0.6s ease' }} />
      {/* Wrist */}
      <circle cx="37" cy="10" r="3.5" fill="#222" />
      {/* Gripper */}
      <rect x="33" y="2" width="4" height="9" rx="1.5" fill="#555"
        transform={active ? 'translate(-3 0) rotate(-15 35 8)' : ''}
        style={{ transition: 'transform 0.5s ease' }} />
      <rect x="33" y="2" width="4" height="9" rx="1.5" fill="#555"
        transform={active ? 'translate(3 0) rotate(15 35 8)' : ''}
        style={{ transition: 'transform 0.5s ease' }} />
      {/* State dot */}
      <circle cx="60" cy="8" r="5" fill={STATE_COLORS[state] ?? '#555'}
        style={{ filter: `drop-shadow(0 0 3px ${STATE_COLORS[state] ?? '#555'})` }} />
    </svg>
  );
}

function TempBar({ temp, label }) {
  const pct = Math.min(100, ((temp - 25) / 75) * 100);
  const col = temp < 50 ? '#00ff88' : temp < 70 ? '#ffcc00' : temp < 85 ? '#ff6600' : '#ff2200';
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ fontSize: 9, color: '#777', fontFamily: 'monospace' }}>{label}</span>
        <span style={{ fontSize: 9, color: col, fontFamily: 'monospace' }}>{temp.toFixed(1)}°C</span>
      </div>
      <div style={{ height: 3, background: '#1a2a1a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: col, transition: 'width 0.5s', borderRadius: 2 }} />
      </div>
    </div>
  );
}

function RobotDetailPanel({ robotId, onClose }) {
  const robots = useFactoryStore((s) => s.robots);
  const r = robots[robotId];
  if (!r) return null;
  const info = ROBOT_NAMES[robotId];
  const stateCol = STATE_COLORS[r.state] ?? '#555';

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 300, height: '100vh',
      background: 'rgba(5,12,5,0.97)', backdropFilter: 'blur(18px)',
      borderLeft: `2px solid ${info.color}55`,
      padding: 16, boxSizing: 'border-box',
      overflowY: 'auto', zIndex: 200,
      animation: 'slideInRight 0.3s ease',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 1 }}>
            Robot {robotId + 1}
          </div>
          <div style={{ fontSize: 15, color: info.color, fontWeight: 'bold', fontFamily: 'monospace' }}>
            {info.emoji} {info.name}
          </div>
          <div style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{info.role}</div>
        </div>
        <button onClick={onClose} style={{
          background: 'rgba(255,255,255,0.05)', border: '1px solid #333', borderRadius: 6,
          color: '#888', fontSize: 14, cursor: 'pointer', padding: '4px 10px', fontFamily: 'monospace'
        }}>✕</button>
      </div>

      {/* Large arm icon */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '12px 0', padding: '12px', background: 'rgba(0,0,0,0.4)', borderRadius: 8 }}>
        <svg width="100" height="120" viewBox="0 0 70 80">
          <rect x="26" y="68" width="18" height="8" rx="3" fill="#333" />
          <rect x="29" y="62" width="12" height="8" rx="2" fill="#444" />
          <rect x="27" y="46" width="16" height="18" rx="4" fill={info.color} opacity="0.9" />
          <rect x="31" y="28" width="8" height="20" rx="3" fill={info.color}
            transform={r.state !== 'IDLE' ? 'rotate(-15 35 46)' : ''} />
          <circle cx="35" cy="28" r="5" fill="#333" />
          <rect x="34" y="10" width="6" height="20" rx="3" fill={info.color} opacity="0.85"
            transform={r.state !== 'IDLE' ? 'rotate(20 35 28)' : ''} />
          <circle cx="37" cy="10" r="3.5" fill="#222" />
          <rect x="33" y="2" width="4" height="9" rx="1.5" fill="#555" />
          <rect x="33" y="2" width="4" height="9" rx="1.5" fill="#555" />
        </svg>
      </div>

      {/* State */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 12px', marginBottom: 12,
        background: `${stateCol}15`, border: `1px solid ${stateCol}44`, borderRadius: 6,
      }}>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>Estado actual</span>
        <span style={{ fontFamily: 'monospace', fontSize: 12, color: stateCol, fontWeight: 'bold' }}>{r.state}</span>
      </div>

      {/* Joint temperatures */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontFamily: 'monospace' }}>
          Temperatura por Joint
        </div>
        {['J1 Base', 'J2 Hombro', 'J3 Codo', 'J4 Muñeca', 'J5 Giro', 'J6 Pinza'].map((label, i) => (
          <TempBar key={i} label={label} temp={r.temperatures[i] ?? 25} />
        ))}
      </div>

      {/* Joint angles */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontFamily: 'monospace' }}>
          Posición Joints (rad)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {['J1', 'J2', 'J3', 'J4', 'J5', 'J6'].map((label, i) => (
            <div key={i} style={{
              padding: '4px 8px', background: 'rgba(0,255,136,0.05)',
              border: '1px solid #1a3a1a', borderRadius: 4,
              display: 'flex', justifyContent: 'space-between'
            }}>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#555' }}>{label}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#00ff88' }}>
                {(r.jointAngles[i] ?? 0).toFixed(3)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Cycles */}
      <div style={{
        padding: '8px 12px', background: 'rgba(0,0,0,0.4)', border: '1px solid #1a3a1a', borderRadius: 6,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#777' }}>Ciclos completados</span>
        <span style={{ fontFamily: 'monospace', fontSize: 14, color: info.color, fontWeight: 'bold' }}>
          {r.cyclesCompleted ?? 0}
        </span>
      </div>

      <div style={{ fontSize: 9, color: '#333', marginTop: 12, textAlign: 'center', fontFamily: 'monospace' }}>
        {STATIONS[robotId]?.name}
      </div>
    </div>
  );
}

export function ControlPanel() {
  const beltSpeed = useFactoryStore((s) => s.beltSpeed);
  const armSpeed  = useFactoryStore((s) => s.armSpeed);
  const running   = useFactoryStore((s) => s.running);
  const pieces    = useFactoryStore((s) => s.pieces);
  const uptime    = useFactoryStore((s) => s.uptime);
  const totalCompleted = useFactoryStore((s) => s.totalPiecesCompleted);
  const robots    = useFactoryStore((s) => s.robots);
  const setSelectedRobot = useFactoryStore((s) => s.setSelectedRobot);

  const setBeltSpeed = useFactoryStore((s) => s.setBeltSpeed);
  const setArmSpeed  = useFactoryStore((s) => s.setArmSpeed);
  const setRunning   = useFactoryStore((s) => s.setRunning);

  const [detailRobot, setDetailRobot] = useState(null);

  const uptimeFmt = `${Math.floor(uptime / 3600).toString().padStart(2,'0')}:${Math.floor((uptime % 3600) / 60).toString().padStart(2,'0')}:${Math.floor(uptime % 60).toString().padStart(2,'0')}`;

  const handleRobotClick = (id) => {
    setDetailRobot(id);
    setSelectedRobot(id);
  };

  const handleCloseDetail = () => {
    setDetailRobot(null);
    setSelectedRobot(null);
  };

  return (
    <>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      `}</style>

      {/* ── Left Panel ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 260, height: '100vh',
        background: 'rgba(5,12,5,0.92)', backdropFilter: 'blur(12px)',
        borderRight: '1px solid #1a3a1a',
        display: 'flex', flexDirection: 'column',
        padding: 14, boxSizing: 'border-box',
        fontFamily: "'Courier New', monospace",
        overflowY: 'auto', zIndex: 100,
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '1px solid #1a3a1a', paddingBottom: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 'bold', color: '#00ff88', letterSpacing: 2 }}>⚙ GEMELO DIGITAL</div>
          <div style={{ fontSize: 8, color: '#555', marginTop: 2 }}>FACTORY CONTROL SYSTEM v2.0</div>
        </div>

        {/* Status + Uptime */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginBottom: 10,
          padding: '5px 8px',
          background: running ? 'rgba(0,255,136,0.08)' : 'rgba(255,60,0,0.12)',
          border: `1px solid ${running ? '#00ff8833' : '#ff3c0033'}`, borderRadius: 6
        }}>
          <span style={{ fontSize: 10, color: running ? '#00ff88' : '#ff4400', animation: running ? 'pulse 2s infinite' : 'none' }}>
            {running ? '● ACTIVO' : '⏸ PAUSADO'}
          </span>
          <span style={{ fontSize: 10, color: '#555' }}>{uptimeFmt}</span>
        </div>

        {/* Play/Pause */}
        <button onClick={() => setRunning(!running)} style={{
          width: '100%', padding: '7px', marginBottom: 12,
          background: running ? 'rgba(255,60,0,0.15)' : 'rgba(0,255,136,0.15)',
          border: `1px solid ${running ? '#ff4400' : '#00ff88'}`,
          borderRadius: 6, color: running ? '#ff6644' : '#00ff88',
          fontFamily: 'monospace', fontSize: 11, cursor: 'pointer', fontWeight: 'bold', letterSpacing: 1,
        }}>
          {running ? '⏸  PAUSAR' : '▶  REANUDAR'}
        </button>

        {/* Velocity sliders */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
            Velocidad Cinta
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min="0.2" max="5" step="0.1" value={beltSpeed}
              onChange={(e) => setBeltSpeed(e.target.value)} style={{ flex: 1, accentColor: '#00ff88', cursor: 'pointer' }} />
            <span style={{ fontSize: 11, color: '#00ff88', minWidth: 42, fontFamily: 'monospace' }}>
              {Number(beltSpeed).toFixed(1)} m/s
            </span>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
            Velocidad Brazos
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min="0.1" max="3" step="0.05" value={armSpeed}
              onChange={(e) => setArmSpeed(e.target.value)} style={{ flex: 1, accentColor: '#00ff88', cursor: 'pointer' }} />
            <span style={{ fontSize: 11, color: '#00ff88', minWidth: 42, fontFamily: 'monospace' }}>
              {Math.round(armSpeed * 100)}%
            </span>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 14 }}>
          {[
            { label: 'Piezas', value: pieces.length },
            { label: 'Completadas', value: totalCompleted },
          ].map((kpi, i) => (
            <div key={i} style={{
              background: 'rgba(0,255,136,0.05)', border: '1px solid #1a3a1a',
              borderRadius: 6, padding: '6px 8px', textAlign: 'center'
            }}>
              <div style={{ fontSize: 9, color: '#555' }}>{kpi.label}</div>
              <div style={{ fontSize: 15, color: '#00ff88', fontWeight: 'bold' }}>{kpi.value}</div>
            </div>
          ))}
        </div>

        {/* Production Pipeline */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Línea de Producción
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {PHASES.map((phase, i) => {
              // Count pieces in this phase
              const count = pieces.filter((p) => p.phase === i).length;
              const isActive = count > 0;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 8px', borderRadius: 5,
                  background: isActive ? `${phase.color}20` : 'rgba(0,0,0,0.2)',
                  border: `1px solid ${isActive ? phase.color + '55' : '#1a2a1a'}`,
                  transition: 'all 0.4s ease',
                }}>
                  {/* Connector line */}
                  {i < PHASES.length - 1 && (
                    <div style={{ position: 'absolute', left: 21, top: '100%', width: 1, height: 3, background: '#1a3a1a' }} />
                  )}
                  <span style={{ fontSize: 13, minWidth: 16, textAlign: 'center' }}>{phase.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: isActive ? phase.color : '#444', fontFamily: 'monospace' }}>
                      {phase.label}
                    </div>
                  </div>
                  {isActive && (
                    <div style={{ display: 'flex', gap: 3 }}>
                      {pieces.filter((p) => p.phase === i).map((p) => (
                        <div key={p.id} style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: phase.color, boxShadow: `0 0 5px ${phase.color}`
                        }} />
                      ))}
                    </div>
                  )}
                  <span style={{ fontSize: 8, color: '#777', fontFamily: 'monospace' }}>R{i + 1}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Robot Cards — click to zoom */}
        <div>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Brazos Robóticos — Click para ver detalles
          </div>
          {ROBOT_NAMES.map((info, id) => {
            const r = robots[id];
            const stateCol = STATE_COLORS[r?.state ?? 'IDLE'] ?? '#555';
            const isActive = r?.state !== 'IDLE';
            return (
              <div key={id}
                onClick={() => handleRobotClick(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', marginBottom: 6,
                  background: `${info.color}10`,
                  border: `1px solid ${isActive ? info.color + '55' : '#1a3a1a'}`,
                  borderRadius: 8, cursor: 'pointer',
                  transition: 'all 0.25s ease',
                  boxShadow: isActive ? `0 0 10px ${info.color}22` : 'none',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = `${info.color}20`}
                onMouseLeave={(e) => e.currentTarget.style.background = `${info.color}10`}
              >
                {/* Small arm SVG */}
                <RobotArmIcon color={info.color} state={r?.state ?? 'IDLE'} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: info.color, fontWeight: 'bold', fontFamily: 'monospace' }}>
                    {info.emoji} {info.name}
                  </div>
                  <div style={{ fontSize: 8, color: '#555', fontFamily: 'monospace', marginBottom: 3 }}>{info.role}</div>
                  <div style={{
                    display: 'inline-block', fontSize: 8, color: stateCol, fontFamily: 'monospace',
                    background: `${stateCol}18`, padding: '1px 5px', borderRadius: 3,
                    border: `1px solid ${stateCol}33`
                  }}>
                    {r?.state ?? 'IDLE'}
                  </div>
                </div>
                <div style={{ fontSize: 9, color: '#333', fontFamily: 'monospace' }}>›</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Robot Detail Panel (slides from right) ── */}
      {detailRobot !== null && (
        <RobotDetailPanel robotId={detailRobot} onClose={handleCloseDetail} />
      )}
    </>
  );
}
