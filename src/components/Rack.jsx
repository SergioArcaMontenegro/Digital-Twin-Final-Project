import React from 'react';
import { RoundedBox } from '@react-three/drei';

export function Rack({ position = [0, 0, 0], rotation = [0, 0, 0], width = 3, height = 4, depth = 1 }) {
  // Generar estantes
  const shelves = [];
  for (let y = 0.5; y <= height; y += 1.2) {
    shelves.push(
      <RoundedBox key={`shelf-${y}`} args={[width, 0.1, depth]} radius={0.02} smoothness={2} receiveShadow castShadow position={[0, y, 0]}>
        <meshStandardMaterial color="#888888" />
      </RoundedBox>
    );
    // Añadir algunas cajas en los estantes con bordes suaves
    shelves.push(
      <RoundedBox key={`box1-${y}`} args={[0.8, 0.8, 0.8]} radius={0.1} smoothness={4} castShadow receiveShadow position={[-width / 3, y + 0.4, 0]}>
        <meshStandardMaterial color="#ffffff" />
      </RoundedBox>,
      <RoundedBox key={`box2-${y}`} args={[0.8, 0.8, 0.8]} radius={0.1} smoothness={4} castShadow receiveShadow position={[width / 3, y + 0.4, 0]}>
        <meshStandardMaterial color="#ffffff" />
      </RoundedBox>
    );
  }

  return (
    <group position={position} rotation={rotation}>
      {/* Postes laterales suavizados */}
      <RoundedBox args={[0.2, height, 0.2]} radius={0.05} smoothness={4} castShadow receiveShadow position={[-width / 2 + 0.1, height / 2, -depth / 2 + 0.1]}>
        <meshStandardMaterial color="#333333" />
      </RoundedBox>
      <RoundedBox args={[0.2, height, 0.2]} radius={0.05} smoothness={4} castShadow receiveShadow position={[width / 2 - 0.1, height / 2, -depth / 2 + 0.1]}>
        <meshStandardMaterial color="#333333" />
      </RoundedBox>
      <RoundedBox args={[0.2, height, 0.2]} radius={0.05} smoothness={4} castShadow receiveShadow position={[-width / 2 + 0.1, height / 2, depth / 2 - 0.1]}>
        <meshStandardMaterial color="#333333" />
      </RoundedBox>
      <RoundedBox args={[0.2, height, 0.2]} radius={0.05} smoothness={4} castShadow receiveShadow position={[width / 2 - 0.1, height / 2, depth / 2 - 0.1]}>
        <meshStandardMaterial color="#333333" />
      </RoundedBox>

      {/* Estantes generados y cajas */}
      {shelves}
    </group>
  );
}
