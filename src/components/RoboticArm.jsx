import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils } from 'three';
import { RoundedBox } from '@react-three/drei';

export function RoboticArm({ 
  position = [0, 0, 0], 
  rotation = [0, 0, 0],
  targetBaseRotation = 0,
  targetArmRotation = 0,
  hasBox = false
}) {
  const baseRef = useRef(null);
  const armRef = useRef(null);

  useFrame((state, delta) => {
    if (baseRef.current && armRef.current) {
      // Interpolar suavemente hacia las rotaciones objetivo
      baseRef.current.rotation.y = MathUtils.lerp(baseRef.current.rotation.y, targetBaseRotation, delta * 3);
      armRef.current.rotation.z = MathUtils.lerp(armRef.current.rotation.z, targetArmRotation, delta * 4);
    }
  });

  return (
    <group position={position} rotation={rotation}>
      {/* Base cilíndrica fija */}
      <mesh castShadow receiveShadow position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.8, 1, 1, 32]} />
        <meshStandardMaterial color="#333333" />
      </mesh>

      {/* Parte giratoria */}
      <group ref={baseRef} position={[0, 1, 0]}>
        {/* Cuerpo principal (amarillo) suavizado */}
        <RoundedBox args={[1, 2, 1]} radius={0.15} smoothness={4} castShadow receiveShadow position={[0, 1, 0]}>
          <meshStandardMaterial color="#ffcc00" />
        </RoundedBox>
        
        {/* Eje de rotación para el brazo */}
        <mesh castShadow position={[0, 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 1.2, 32]} />
          <meshStandardMaterial color="#222222" />
        </mesh>

        {/* Brazo articulado */}
        <group ref={armRef} position={[0, 2, 0]}>
          {/* Segmento del brazo suavizado */}
          <RoundedBox args={[3, 0.5, 0.5]} radius={0.1} smoothness={4} castShadow receiveShadow position={[1.5, 0, 0]}>
            <meshStandardMaterial color="#ffcc00" />
          </RoundedBox>
          
          {/* Herramienta final (Pinza) */}
          <mesh castShadow receiveShadow position={[3.2, -0.5, 0]}>
            <cylinderGeometry args={[0.1, 0.3, 1, 16]} />
            <meshStandardMaterial color="#444444" />
          </mesh>

          {/* Caja atada al brazo suavizada */}
          {hasBox && (
            <RoundedBox args={[1, 1, 1]} radius={0.15} smoothness={4} castShadow receiveShadow position={[3.2, -1.5, 0]}>
              <meshStandardMaterial color="#ffffff" />
            </RoundedBox>
          )}
        </group>
      </group>
    </group>
  );
}
