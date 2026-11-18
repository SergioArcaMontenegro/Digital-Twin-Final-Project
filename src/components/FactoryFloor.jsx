import React from 'react';
import { Plane } from '@react-three/drei';

export function FactoryFloor() {
  return (
    <group>
      <Plane
        args={[100, 100]}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <meshStandardMaterial color="#2d5a4c" />
      </Plane>
      {/* Grid helper para dar aspecto técnico */}
      <gridHelper args={[100, 100, '#ffffff', '#555555']} position={[0, 0, 0]} material-opacity={0.2} material-transparent />
    </group>
  );
}
