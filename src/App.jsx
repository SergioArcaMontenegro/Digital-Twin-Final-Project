import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Plant } from './components/Plant';
import { RollerConveyor, LinePieces } from './components/Line';
import { Logistics3D } from './components/Logistics3D';
import { Robot } from './components/Robot';
import { TwinPanel } from './ui/TwinPanel';
import { ROBOTS, CELLS } from './sim/layout';
import { engine } from './sim/engine';
import { useTwinStore } from './store/useTwinStore';
import './ui/twin.css';

/** Avanza el motor del gemelo y refresca la interfaz ~5 veces por segundo. */
function SimDriver() {
  const refresh = useTwinStore((s) => s.refresh);
  const acc = useRef(0);
  useFrame((_, dt) => {
    engine.step(dt);
    acc.current += dt;
    if (acc.current > 0.2) { acc.current = 0; refresh(); }
  });
  return null;
}

const VIEWS = {
  overview: { pos: [-4, 56, 62], target: [-2, 0, -1] },
  saw: { pos: [-28, 14, 6], target: [-40, 2, 20] },
  kiln: { pos: [-38, 13, 8], target: [-52, 2, -10] },
  cnc: { pos: [-16, 13, 3], target: [-16, 1, -17] },
  ens: { pos: [16, 13, 3], target: [16, 1.2, -17] },
  pal: { pos: [52, 13, 4], target: [41, 1.2, -12] },
  store: { pos: [26, 15, 2], target: [46, 1.5, 16] },
  control: { pos: [3, 12, 4], target: [3, 7, 16] },
};

/** Lleva la cámara a la vista elegida y después la deja libre. */
function CameraRig({ controls }) {
  const focus = useTwinStore((s) => s.focusCell);
  const setFocus = useTwinStore((s) => s.setFocus);
  const { camera } = useThree();
  const goal = useRef(null);
  // Vista arbitraria (útil para enlazar cámaras desde fuera): window.dispatchEvent(new CustomEvent('twin:view', { detail: { pos, target } }))
  useEffect(() => {
    const onView = (e) => { goal.current = { pos: new THREE.Vector3(...e.detail.pos), target: new THREE.Vector3(...e.detail.target) }; };
    window.addEventListener('twin:view', onView);
    return () => window.removeEventListener('twin:view', onView);
  }, []);
  useEffect(() => {
    if (!focus) return;
    const v = VIEWS[focus];
    goal.current = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
  }, [focus]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!goal.current || !c) return;
    const k = 1 - Math.exp(-dt * 3);
    camera.position.lerp(goal.current.pos, k);
    c.target.lerp(goal.current.target, k);
    c.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.05) { goal.current = null; if (focus) setFocus(null); }
  });
  return null;
}

function Scene() {
  const controls = useRef(null);
  return (
    <>
      <SimDriver />
      <CameraRig controls={controls} />
      <color attach="background" args={['#d9dde1']} />
      <fog attach="fog" args={['#d9dde1', 150, 320]} />
      <hemisphereLight args={['#ffffff', '#8c8a84', 1.25]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow position={[-30, 55, 28]} intensity={2.4} color="#fffaf0"
        shadow-mapSize={[4096, 4096]} shadow-bias={-0.0003} shadow-normalBias={0.02}
        shadow-camera-left={-80} shadow-camera-right={80} shadow-camera-top={40} shadow-camera-bottom={-40}
        shadow-camera-near={1} shadow-camera-far={160}
      />
      <directionalLight position={[40, 30, -30]} intensity={0.7} color="#eef3ff" />

      <Plant />
      <RollerConveyor />
      <LinePieces />
      <Logistics3D />
      <Suspense fallback={null}>
        {ROBOTS.map((r) => <Robot key={r.id} def={r} />)}
      </Suspense>

      <OrbitControls
        ref={controls} makeDefault enableDamping dampingFactor={0.08}
        target={VIEWS.overview.target} minDistance={2.5} maxDistance={220} maxPolarAngle={Math.PI / 2 - 0.03}
        onStart={() => useTwinStore.getState().setFocus(null)}
      />
    </>
  );
}

export default function App() {
  return (
    <div className="app">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: VIEWS.overview.pos, fov: 38, near: 0.1, far: 400 }}
        gl={{ antialias: true }}
        onPointerMissed={() => useTwinStore.getState().selectedRobot && useTwinStore.getState().selectRobot(null)}
      >
        <Scene />
      </Canvas>
      <TwinPanel cells={CELLS} />
    </div>
  );
}
