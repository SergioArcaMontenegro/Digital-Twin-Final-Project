import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils } from 'three';
import { RoundedBox } from '@react-three/drei';

export function BoxItem({ 
  position = [0, 1.5, 0], 
  visible = true 
}) {
  const ref = useRef(null);

  useFrame((state, delta) => {
    if (ref.current) {
      // Movimiento suave hacia la posición objetivo
      ref.current.position.x = MathUtils.lerp(ref.current.position.x, position[0], delta * 5);
      ref.current.position.y = MathUtils.lerp(ref.current.position.y, position[1], delta * 5);
      ref.current.position.z = MathUtils.lerp(ref.current.position.z, position[2], delta * 5);
    }
  });

  if (!visible) return null;

  return (
    <RoundedBox 
      ref={ref} 
      args={[1, 1, 1]} 
      radius={0.15} 
      smoothness={4} 
      castShadow 
      receiveShadow 
      position={position}
    >
      <meshStandardMaterial color="#ffffff" />
    </RoundedBox>
  );
}
