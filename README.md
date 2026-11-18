# Gemelo Digital · Celdas Robóticas en Planta de Madera

Visor web 3D del gemelo digital de una planta de transformación de madera en U:
troncos → aserrado → secado → cepillado → **celdas robóticas redundantes** (fresado CNC,
lijado, ensamblaje, barnizado) → paletizado → almacén → expedición.

En cada cambio de turno (8 h) el gemelo **recomienda** el reparto de carga entre los brazos
de cada celda o la conmutación a ciclo **monobrazo (100 %)** para hacer mantenimiento
preventivo escalonado sin parar la línea; el responsable **aprueba** y el PLC **ejecuta**
(el brazo se aparca, el resto asume su trabajo y se abre una OT en el GMAO).

## Arrancar

```bash
npm install
npm run dev              # desarrollo  → http://localhost:5173
npm run build            # compilación → dist/
npm run models:robots    # regenera los 4 robots .glb a partir de src/robots/robotSpecs.js
```

### Docker

```bash
docker compose up --build    # → http://localhost:8080
```

`Dockerfile` multietapa: compila con Node 22 (regenerando los modelos) y sirve `dist/`
con nginx (`nginx.conf`: gzip, caché y tipo MIME de los `.glb`). Todo es estático y no
usa fuentes ni recursos externos, así que funciona sin conexión.

## Qué hay en la escena

| Fase | Equipo | Coordinación |
|---|---|---|
| Patio de troncos | **Pórtico grúa** con garra de troncos | Solo carga la mesa si la sierra la ha liberado |
| Aserradero | Sierra de cinta con carro | Corta cuando hay tronco y la mesa de salida está libre |
| Apilado | **Pórtico cartesiano** con viga de ventosas | Apila hasta 6 capas; pila llena → avisa al AGV-A |
| Secadero | Cámara con puertas enrollables (4 pilas) | AGV-A entra la pila verde, AGV-B saca la seca |
| Cepillado | Cepilladora-moldurera | Consume una capa de la pila seca por tablero |
| CNC (2 brazos) | 6 ejes pesado + **electrohusillo** | Fresa el perfil y taladra |
| Lijado (2) | 6 ejes medio + **lijadora orbital** | Pasadas en serpentina |
| Ensamblaje (3) | 6 ejes medio + **garra de vacío y atornillador** | Coge laterales del rack, los monta y atornilla |
| Barnizado (2) | 6 ejes ATEX **colgados del techo** + pistola HVLP | Cabina presurizada |
| Paletizado | **Paletizador de 4 ejes** + pinza de horquilla + enfardadora | 4 módulos por palé |
| Almacén / muelle | **Carretillas AGV** (C y D) + camión | Hueco libre más cercano; expedición FIFO |

**AGVs:** carriles de sentido único con flechas pintadas; el gestor de tráfico concede cada
nodo (cruce, parada) a un solo AGV y exige 2,2 m libres. Si no obtiene su siguiente nodo,
el AGV espera (baliza ámbar, “Cede el paso a …”). Cargan batería en su base.

Los brazos tienen equilibrador de muelle (robot pesado), paquete de motores trasero,
mangueras, cambiador rápido de herramienta y anillo de estado (verde / ámbar / rojo / azul).

## Modelo del gemelo (`src/sim/engine.js`)

| Símbolo | En el código |
|---|---|
| S<sub>t</sub> estado físico | `wear` (desgaste reductora/servo), `temp` (bobinado) |
| O<sub>t</sub> observaciones | `current` (A rms), `measured` (PT100/KTY con ruido), alarmas |
| U<sub>t</sub> entradas de control | `share` (reparto), `accel` (−12 % ejes 2-3), `status` (mantenimiento) |
| D<sub>t</sub> estado digital | `rthEst` (R<sub>th</sub> calibrada), `i2t`, modelo 3D sincronizado |
| Q<sub>t</sub> cantidades de interés | `rul`, `whatIfStop()` (margen térmico y takt), viabilidad monobrazo |
| R<sub>t</sub> criterio | KPIs: horas de marcha continua, 0 paradas simultáneas, takt |

- Térmico de primer orden: `T → T_amb + (R_th/R_th,nom)·K·ciclo·acel²·(1+0,35·desgaste)²`, τ = 15 min.
  Alarma 95 °C, disparo 110 °C.
- Desgaste tipo Arrhenius: se duplica cada +10 °C y escala con el ciclo y la aceleración².
- Validación: error modelo-medida dentro de ±4 °C (se muestra en la ficha de cada robot).

**Demostración:** desactiva *Gemelo*, pon *1 h/s* y deja correr una semana: los tres brazos
de Ensamblaje (desgaste inicial idéntico) fallan en menos de tres horas y la línea se para.
Con el gemelo activo y *Auto-aprobar*, los preventivos se escalonan y no hay paradas.

## Estructura

```
src/
  App.jsx                escena, luces, cámaras, driver de simulación
  robots/robotSpecs.js   cotas de robots y herramientas (compartidas con el generador)
  sim/engine.js          motor del gemelo (térmico, desgaste, reparto, turnos, what-if)
  sim/layout.js          celdas, posiciones de robots y puntos de trabajo
  sim/ik.js              cinemática inversa analítica
  sim/logistics.js       pórticos, sierra, secadero, paletizador, AGVs y gestor de tráfico
  components/Robot.jsx   brazo de celda + efectos de herramienta (virutas, polvo, barniz…)
  components/robotCommon.js  carga de GLB, articulaciones, equilibrador/paralelogramo
  components/Line.jsx    transportador de rodillos y piezas (tablero → módulo barnizado)
  components/Logistics3D.jsx patio, pórticos, aserradero, AGVs, paletizador, almacén, camión
  components/Plant.jsx   nave, zonas de seguridad y vallado, cabina, secadero, aspiración
  ui/TwinPanel.jsx       HUD: KPIs, decisión de turno, celdas, ficha y what-if
scripts/generate-robots.mjs   generador de los GLB de los robots
```

Ya no se usan (se pueden borrar): `AdvancedRobot.jsx`, `UConveyor.jsx`, `WorkPiece.jsx`,
`useFactoryStore.js`, `ControlPanel.jsx`, `public/models/robot_arm.glb` y los GLB de la
versión de automoción (`robot_stamping|welding|painting.glb`).
