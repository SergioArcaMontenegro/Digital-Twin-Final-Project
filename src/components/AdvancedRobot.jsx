import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Color, MathUtils } from 'three';
import { useFactoryStore, STATIONS, PHASES } from '../store/useFactoryStore';

const PHASES_COUNT = 6; // total transformation phases

// ── Joint angle configs per state ──
// [baseY, shoulderZ, elbowZ, wristZ, wristRollX, gripperAngle]
// Robots 0-2: upper belt side (z+), facing -Z (toward z=5)
// Robots 3-5: lower belt side (z-), facing +Z (toward z=-5)

const getJointConfigs = (stationId) => {
  const side = stationId < 3 ? 1 : -1; // upper=+1, lower=-1
  return {
    IDLE:       [0,       -0.5,  0.8,  -0.3,  0,     0.4],
    REACHING:   [0,        0.3, -0.1,  -0.2,  0,     0.4],
    GRIPPING:   [0,        0.3, -0.1,  -0.2,  0,    -0.15],
    LIFTING:    [0,       -0.3,  0.3,  -0.1,  0,    -0.15],
    WORKING:    [side * Math.PI * 0.55, -0.1,  0.4,   0.0,  0.3,  -0.15],
    LOWERING:   [0,        0.3, -0.1,  -0.2,  0,    -0.15],
    RELEASING:  [0,        0.3, -0.1,  -0.2,  0,     0.4],
    RETRACTING: [0,       -0.5,  0.8,  -0.3,  0,     0.4],
  };
};

// Durations in seconds per state
const STATE_DURATIONS = {
  IDLE: Infinity,
  REACHING: 2.0,
  GRIPPING: 0.6,
  LIFTING: 1.4,
  WORKING: 3.5,
  LOWERING: 1.4,
  RELEASING: 0.5,
  RETRACTING: 1.6,
};

const NEXT_STATE = {
  REACHING: 'GRIPPING',
  GRIPPING: 'LIFTING',
  LIFTING: 'WORKING',
  WORKING: 'LOWERING',
  LOWERING: 'RELEASING',
  RELEASING: 'RETRACTING',
  RETRACTING: 'IDLE',
};

// Temp-per-joint: velocity → heat
function updateTemperature(temps, jointAngles, targetAngles, delta) {
  return temps.map((t, i) => {
    const velocity = Math.abs(targetAngles[i] - jointAngles[i]);
    const heat = velocity * 30;
    const cooling = (t - 25) * 0.5;
    return Math.max(25, t + (heat - cooling) * delta);
  });
}

function tempColor(temp) {
  if (temp < 50) return '#00ff44';
  if (temp < 70) return '#ffcc00';
  if (temp < 85) return '#ff6600';
  return '#ff2200';
}

// ── Modelo 3D (generado con scripts/generate-robot-arm.mjs) ────────────────
const MODEL_URL = `${import.meta.env.BASE_URL}models/robot_arm.glb`;
useGLTF.preload(MODEL_URL);

const FINGER_OPEN = 0.2;   // separación de cada dedo (x) con la pinza abierta
const FINGER_CLOSED = 0.1; // separación con la pinza cerrada sobre la pieza

/** Clona el GLB para este robot y localiza articulaciones, dedos y LEDs. */
function useRobotModel() {
  const { scene } = useGLTF(MODEL_URL);
  return useMemo(() => {
    const root = scene.clone(true);
    const leds = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.name.startsWith('LED_')) {
        o.material = o.material.clone(); // material propio: cada robot colorea sus LEDs
        o.castShadow = false;
        leds[Number(o.name.slice(4))] = o.material;
      }
    });
    const get = (n) => root.getObjectByName(n);
    return {
      root,
      joints: ['J0', 'J1', 'J2', 'J3', 'J4'].map(get),
      fingers: [get('Finger_L'), get('Finger_R')],
      leds,
    };
  }, [scene]);
}

export function AdvancedRobot({ robotId }) {
  const station = STATIONS[robotId];
  const { robotPos } = station;
  const side = robotId < 3 ? 1 : -1;

  const robots = useFactoryStore((s) => s.robots);
  const pieces = useFactoryStore((s) => s.pieces);
  const armSpeed = useFactoryStore((s) => s.armSpeed);
  const running = useFactoryStore((s) => s.running);
  const updateRobot = useFactoryStore((s) => s.updateRobot);
  const updatePiece = useFactoryStore((s) => s.updatePiece);
  const addEvent = useFactoryStore((s) => s.addEvent);
  const incrementCompleted = useFactoryStore((s) => s.incrementCompleted);

  const robot = robots[robotId];
  const jointRefs = useRef(robot.jointAngles.map((v) => v));
  const stateTimerRef = useRef(0);
  const workOscRef = useRef(0);

  // Nodos del modelo: J0 base (Y), J1 hombro (Z), J2 codo (Z), J3 muñeca pitch (Z), J4 muñeca roll (Y)
  const model = useRobotModel();
  const fingerXRef = useRef(FINGER_OPEN);
  const ledColor = useMemo(() => new Color(), []);

  const configs = getJointConfigs(robotId);

  useFrame((_, delta) => {
    if (!running) return;

    const r = useFactoryStore.getState().robots[robotId];
    const allPieces = useFactoryStore.getState().pieces;
    const speed = useFactoryStore.getState().armSpeed;

    stateTimerRef.current += delta;
    workOscRef.current += delta;

    // ── State transitions ──────────────────────────────────────────────────
    if (r.state === 'IDLE') {
      // Look for a piece that is near this station's x pickup position
      const targetPiece = allPieces.find(
        (p) =>
          p.heldByRobot === null &&
          Math.abs(p.worldPos[0] - station.pickupPos[0]) < 1.2 &&
          (robotId < 3
            ? Math.abs(p.worldPos[2] - 5) < 0.5
            : Math.abs(p.worldPos[2] - (-5)) < 0.5)
      );
      if (targetPiece) {
        // Claim this piece and start reaching
        updatePiece(targetPiece.id, { heldByRobot: robotId });
        updateRobot(robotId, { state: 'REACHING', heldPieceId: targetPiece.id });
        stateTimerRef.current = 0;
        addEvent(`🤖 Robot ${robotId + 1}: Recogiendo pieza #${targetPiece.id + 1}`);
      }
    } else {
      const dur = STATE_DURATIONS[r.state];
      if (stateTimerRef.current >= dur) {
        const nextState = NEXT_STATE[r.state];

        let patch = { state: nextState };

        if (r.state === 'GRIPPING') {
          // Piece is now held — freeze it in space (handled in WorkPiece)
        }
        if (r.state === 'WORKING') {
          // Apply phase transformation
          const piece = allPieces.find((p) => p.id === r.heldPieceId);
          if (piece) {
            const newPhase = Math.min(piece.phase + 1, PHASES_COUNT - 1);
            updatePiece(piece.id, { phase: newPhase });
            const phaseName = (PHASES && PHASES[newPhase]) ? PHASES[newPhase].name : `Fase ${newPhase}`;
            addEvent(`✅ Robot ${robotId + 1}: Pieza #${piece.id + 1} → ${phaseName}`);
          }
        }
        if (r.state === 'RELEASING') {
          // Release piece back to belt
          const piece = allPieces.find((p) => p.id === r.heldPieceId);
          if (piece) {
            updatePiece(piece.id, { heldByRobot: null });
          }
          patch = { ...patch, heldPieceId: null, gripperOpen: true };
          if (robotId === 5) incrementCompleted();
        }
        if (r.state === 'GRIPPING') {
          patch.gripperOpen = false;
        }
        if (r.state === 'RELEASING') {
          patch.gripperOpen = true;
        }

        updateRobot(robotId, patch);
        stateTimerRef.current = 0;
      }
    }

    // ── Joint angle interpolation ──────────────────────────────────────────
    const r2 = useFactoryStore.getState().robots[robotId];
    const targets = configs[r2.state] ?? configs.IDLE;

    // Working oscillation (wrist)
    let osc = 0;
    if (r2.state === 'WORKING') {
      osc = Math.sin(workOscRef.current * 3) * 0.15;
    }

    const lerpSpeed = speed * 2.5;
    const newAngles = jointRefs.current.map((a, i) => {
      const tgt = targets[i] + (i === 3 ? osc : 0);
      return MathUtils.lerp(a, tgt, delta * lerpSpeed);
    });
    jointRefs.current = newAngles;

    // Update temperature
    const newTemps = updateTemperature(r2.temperatures, r2.jointAngles, targets, delta);
    updateRobot(robotId, { jointAngles: newAngles, temperatures: newTemps, gripperOpen: r2.state !== 'GRIPPING' && r2.state !== 'LIFTING' && r2.state !== 'WORKING' && r2.state !== 'LOWERING' });

    // Aplicar ángulos al modelo 3D
    const [j0, j1, j2, j3, j4] = model.joints;
    j0.rotation.y = newAngles[0];
    j1.rotation.z = newAngles[1];
    j2.rotation.z = newAngles[2];
    j3.rotation.z = newAngles[3];
    j4.rotation.y = newAngles[4];

    // Pinza paralela: los dedos se deslizan en X
    const closed = ['GRIPPING', 'LIFTING', 'WORKING', 'LOWERING'].includes(r2.state);
    fingerXRef.current = MathUtils.lerp(fingerXRef.current, closed ? FINGER_CLOSED : FINGER_OPEN, delta * 8);
    model.fingers[0].position.x = -fingerXRef.current;
    model.fingers[1].position.x = fingerXRef.current;

    // LEDs de temperatura por articulación
    newTemps.forEach((temp, i) => {
      const mat = model.leds[i];
      if (!mat) return;
      ledColor.set(tempColor(temp));
      mat.color.copy(ledColor);
      mat.emissive.copy(ledColor);
    });
  });

  return (
    <group position={robotPos}>
      <primitive object={model.root} />
    </group>
  );
}
