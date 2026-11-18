import React, { useRef } from 'react';
import { RoundedBox } from '@react-three/drei';

export function ConveyorBelt({ position = [0, 0, 0], rotation = [0, 0, 0], length = 10 }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Estructura principal de la cinta con bordes suaves */}
      <RoundedBox args={[length, 1, 2]} radius={0.1} smoothness={4} castShadow receiveShadow position={[0, 0.5, 0]}>
        <meshStandardMaterial color="#555555" />
      </RoundedBox>
      
      {/* Cinta móvil (parte superior oscura) */}
      <RoundedBox args={[length - 0.2, 0.05, 1.8]} radius={0.02} smoothness={2} receiveShadow position={[0, 1.02, 0]}>
        <meshStandardMaterial color="#222222" />
      </RoundedBox>

      {/* Barandillas protectoras amarillas redondeadas */}
      <RoundedBox args={[length, 0.5, 0.1]} radius={0.05} smoothness={4} castShadow position={[0, 1.5, 1.1]}>
        <meshStandardMaterial color="#ffcc00" transparent opacity={0.6} />
      </RoundedBox>
      <RoundedBox args={[length, 0.5, 0.1]} radius={0.05} smoothness={4} castShadow position={[0, 1.5, -1.1]}>
        <meshStandardMaterial color="#ffcc00" transparent opacity={0.6} />
      </RoundedBox>
      
      {/* Soportes */}
      <RoundedBox args={[0.3, 0.5, 2.2]} radius={0.1} smoothness={4} castShadow position={[-length / 2 + 1, 0.25, 0]}>
        <meshStandardMaterial color="#444444" />
      </RoundedBox>
      <RoundedBox args={[0.3, 0.5, 2.2]} radius={0.1} smoothness={4} castShadow position={[length / 2 - 1, 0.25, 0]}>
        <meshStandardMaterial color="#444444" />
      </RoundedBox>
    </group>
  );
}
