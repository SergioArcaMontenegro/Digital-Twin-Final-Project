import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { ROBOT_MODELS } from '../robots/robotSpecs';

export const modelUrl = (key) => `${import.meta.env.BASE_URL}models/${ROBOT_MODELS[key].file}`;
Object.keys(ROBOT_MODELS).forEach((k) => useGLTF.preload(modelUrl(k)));

/**
 * Pieza telescópica entre dos anclajes de eslabones distintos (equilibrador de muelle,
 * biela del paralelogramo). Se recoloca en cada frame tras mover las articulaciones.
 */
function makeStrut(root, a, b, { tube = 0.06, rod = 0.03, tubeLen = 0.5, color = '#2b2d31' }) {
  const g = new THREE.Group();
  const tubeMesh = new THREE.Mesh(new THREE.CylinderGeometry(tube, tube, 1, 20).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.4 }));
  const rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(rod, rod, 1, 14).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: '#c3c8ce', metalness: 1, roughness: 0.2 }));
  tubeMesh.castShadow = rodMesh.castShadow = true;
  g.add(tubeMesh, rodMesh);
  root.add(g);
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), dir = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  return () => {
    a.getWorldPosition(pa); b.getWorldPosition(pb);
    root.worldToLocal(pa); root.worldToLocal(pb);
    dir.subVectors(pb, pa);
    const len = dir.length();
    dir.normalize();
    tubeMesh.position.copy(pa);
    tubeMesh.quaternion.setFromUnitVectors(up, dir);
    tubeMesh.scale.set(1, Math.min(tubeLen, len * 0.8), 1);
    rodMesh.position.copy(pb);
    rodMesh.quaternion.setFromUnitVectors(up, dir.clone().negate());
    rodMesh.scale.set(1, Math.max(0.05, len - Math.min(tubeLen, len * 0.8) + 0.08), 1);
  };
}

/** Clona el GLB y localiza articulaciones, herramienta, anillo de estado y piezas dinámicas. */
export function useRobotModel(modelKey) {
  const { scene } = useGLTF(modelUrl(modelKey));
  return useMemo(() => {
    const root = scene.clone(true);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const get = (n) => root.getObjectByName(n);
    const ring = get('StatusRing');
    ring.material = ring.material.clone();
    ring.castShadow = false;
    const struts = [];
    if (get('CB_A') && get('CB_B')) struts.push(makeStrut(root, get('CB_A'), get('CB_B'), { tube: 0.075, rod: 0.035, tubeLen: 0.55 }));
    if (get('PR_A') && get('PR_B')) struts.push(makeStrut(root, get('PR_A'), get('PR_B'), { tube: 0.05, rod: 0.035, tubeLen: 0.9, color: '#ffc21a' }));
    return {
      root, ring, struts,
      joints: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'].map(get),
      tcp: get('TCP'),
      bit: get('Bit'), pad: get('Pad'), driver: get('Driver'),
      clamps: [get('Clamp_L'), get('Clamp_R')].filter(Boolean),
    };
  }, [scene]);
}

/** Aplica los ángulos articulares y recoloca las piezas dinámicas. */
export function applyJoints(model, q) {
  const [j1, j2, j3, j4, j5, j6] = model.joints;
  j1.rotation.y = q[0];
  j2.rotation.z = q[1];
  j3.rotation.z = q[2];
  j4.rotation.x = q[3];
  j5.rotation.z = q[4];
  j6.rotation.x = q[5];
  if (model.struts.length) {
    model.root.updateMatrixWorld(true);
    for (const s of model.struts) s();
  }
}

export const STATUS_COLOR = { RUN: '#29d36a', WARN: '#ffb020', FAULT: '#ff3030', MAINT: '#2f8cff', IDLE: '#9aa3ad' };
