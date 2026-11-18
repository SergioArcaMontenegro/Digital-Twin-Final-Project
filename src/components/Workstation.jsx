import React, { useState, useEffect } from 'react';
import { RoboticArm } from './RoboticArm';
import { BoxItem } from './BoxItem';
import { ConveyorBelt } from './ConveyorBelt';

export function Workstation({ 
  position = [0, 0, 0], 
  beltLength = 20 
}) {
  const [state, setState] = useState('MOVING_IN');
  const [boxPosition, setBoxPosition] = useState([-beltLength / 2, 1.5, position[2]]);
  const [boxVisible, setBoxVisible] = useState(true);
  
  const [armBaseRotation, setArmBaseRotation] = useState(0);
  const [armZRotation, setArmZRotation] = useState(-0.5); // Posición levantada
  const [armHasBox, setArmHasBox] = useState(false);

  // Coordenada local de recogida
  const pickupX = position[0];

  useEffect(() => {
    let timeout;
    
    switch (state) {
      case 'MOVING_IN':
        // La caja se mueve hasta el punto de recogida
        setBoxPosition([pickupX, 1.5, position[2]]);
        setBoxVisible(true);
        setArmHasBox(false);
        setArmBaseRotation(0);
        setArmZRotation(-0.5); // Brazo levantado esperando
        
        // Simular el tiempo que tarda la caja en llegar por la cinta
        timeout = setTimeout(() => setState('PICKING'), 2000);
        break;
        
      case 'PICKING':
        // El brazo baja a por la caja
        setArmZRotation(0.3); // Brazo baja
        
        // Tiempo en bajar
        timeout = setTimeout(() => {
          setBoxVisible(false); // Ocultamos la caja de la cinta
          setArmHasBox(true);   // La mostramos atada al brazo
          setState('ROTATING');
        }, 800);
        break;
        
      case 'ROTATING':
        // El brazo sube y gira
        setArmZRotation(-0.5); // Levanta
        setArmBaseRotation(Math.PI / 2); // Gira 90 grados hacia atrás (hacia el rack)
        
        // Tiempo en girar
        timeout = setTimeout(() => setState('DROPPING'), 1500);
        break;
        
      case 'DROPPING':
        // El brazo baja para soltar
        setArmZRotation(0.3);
        
        timeout = setTimeout(() => {
          setArmHasBox(false); // Suelta la caja
          // Nota: Para ser 100% real, aquí generaríamos una nueva caja estática en el rack.
          // Por simplicidad en esta demo, hacemos desaparecer la caja y reseteamos.
          setState('RESETTING');
        }, 800);
        break;
        
      case 'RESETTING':
        // Sube y vuelve a posición inicial
        setArmZRotation(-0.5);
        setArmBaseRotation(0);
        
        // Empieza el ciclo con una caja nueva
        timeout = setTimeout(() => {
          setBoxPosition([-beltLength / 2 - 2, 1.5, position[2]]); // Reinicia posición
          setState('MOVING_IN');
        }, 1500);
        break;
    }
    
    return () => clearTimeout(timeout);
  }, [state, pickupX, beltLength, position]);

  return (
    <group>
      {/* Cinta transportadora de la estación */}
      <ConveyorBelt position={[position[0], 0, position[2]]} length={beltLength} />
      
      {/* Brazo Robótico (ubicado detrás de la cinta) */}
      <RoboticArm 
        position={[position[0] - 3.5, 0, position[2] + 2.5]} 
        targetBaseRotation={armBaseRotation}
        targetArmRotation={armZRotation}
        hasBox={armHasBox}
      />
      
      {/* Caja que viaja por la cinta */}
      <BoxItem position={boxPosition} visible={boxVisible} />
    </group>
  );
}
