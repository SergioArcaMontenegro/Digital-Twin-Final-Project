# Gemelo digital · Planta de transformación de madera

Gemelo digital **jugable y coherente** de una fábrica de muebles de madera. Un servidor
calcula una única planta compartida y la sirven tres aplicaciones:

| Ruta | Aplicación | Para quién |
|---|---|---|
| `/` | **Visor 3D** de la planta, con modo edición | Sala de control, jefe de planta |
| `/admin/` | **Administración**: caja, pedidos, producción, compras, plantilla, robots | Gerencia (`digitaltwins` / `digitaltwins2026`) |
| `/app/` | **App móvil** del operario (PWA instalable) | Cada trabajador con su usuario y clave |

Lo que hace la gerencia en su app o un operario en el móvil se ve al instante en la planta
3D, y al revés. La especificación completa está en [`ESPECIFICACION.md`](ESPECIFICACION.md).

## Arrancar

```bash
npm install
npm run dev        # desarrollo: servidor + Vite en http://localhost:8080 (recarga en caliente)
npm run build      # compila las tres webs en dist/
npm start          # producción: sirve dist/ y el WebSocket en http://localhost:8080
npm test           # pruebas de la simulación (layout, IK, hub, AGV, gemelo una semana)
npm run models:robots   # regenera los .glb de los robots desde shared/robotSpecs.js
```

Al arrancar, el servidor muestra también la dirección en la red local para abrir la app
móvil desde el teléfono (`http://IP:8080/app/`). Sin servidor (por ejemplo `npm run dev:vite`
o añadiendo `?local` a la URL) la simulación corre en el propio navegador.

### Docker

```bash
docker compose up --build      # → http://localhost:8080
```

`Dockerfile` multietapa: compila con Node 22 (regenerando los modelos de los robots) y
ejecuta el servidor de simulación (`node server/index.mjs`, solo depende de `ws`). El estado
se guarda cada 30 s y al parar en el volumen `/data` (`estado.json`), así que sobrevive a
reinicios. Salud: `GET /salud`. Estado completo en JSON: `GET /api/estado`.

## Usuarios

Al empezar solo existe la cuenta de gerencia: usuario **`digitaltwins`**, clave
**`digitaltwins2026`**. Con ella se entra en `/admin/` y en el modo edición del visor.

Los trabajadores los creas tú en **Administración → Plantilla → Nuevo usuario**: nombre,
usuario, clave (4–32 caracteres), función, turno (M 6–14, T 14–22, N 22–6 o jornada
08–17) y zona. Desde la misma tabla cambias su turno o zona al momento, le pones otra
clave, lo das de baja o lo eliminas. Cada uno entra en la app móvil con su usuario y clave
y puede cambiar su clave en «Perfil».

Mientras no haya nadie en un puesto, lo cubre **personal simulado** (sin acceso a la app;
cobra su salario) para que la planta no se pare. Se desactiva en Plantilla o en Simulación:
entonces un puesto sin nadie de su función detiene su parte de la planta.

| Función | Qué ve y hace en su app |
|---|---|
| Jefe de turno | Producción del turno, puestos cubiertos, **aprueba la decisión del gemelo** |
| Aserrador | Patio de troncos, camiones en camino, **da entrada a los camiones**, secadero |
| Cepillador | Pila seca, próximas órdenes |
| Mecanizado (CNC + lijado) | Lo procesado en su turno, robots de sus celdas |
| Montaje y acabado | Lo procesado en su turno, robots de ENS y BAR |
| Logística | Almacén, AGV, **confirma la salida de camiones** |
| Mantenimiento | Salud de los brazos, **ejecuta OT preventivas y correctivas** |
| Comercial | **Acepta o rechaza pedidos**, cartera, stock libre |

Todos ven lo que han fabricado en su turno, los pedidos en curso y pueden avisar de
incidencias. Si nadie hace una tarea desde la app, el trabajador (real o simulado) de ese
turno la hace solo al cabo de unos minutos (desactivable en Administración → Simulación).

## La planta

```
camión de troncos → patio (4 especies) → pórtico de troncos → sierra de cinta → pórtico apilador
→ pila verde → AGV-A → secadero → AGV-B → cepilladora (CEP) → cinta: CNC → LIJ → ENS → BAR
→ paletizador (2 puestos) → AGV-C → almacén → AGV-D → camión → cliente
```

**La madera cambia de forma:** tronco con corteza → tablas verdes → pila seca → tablas
cepilladas → tablero encolado → el CNC recorta las piezas (patas, asiento, respaldo,
tablero, baldas…) → se lijan pieza a pieza → los robots de ensamblaje **cogen cada pieza
y la colocan** hasta formar la silla, mesa o estantería → barniz del tono del pedido →
palé enfardado → camión. Los tablones no pasan por el CNC ni por el ensamblaje.

**Productos:** lote de tablones, silla, mesa y estantería en pino, haya, roble o nogal, con
acabado natural, miel, nogal, lacado blanco o negro. Cada orden de fabricación decide a qué
se destina la madera, el acabado y la ruta (LIJ y BAR son opcionales).

**Economía:** caja y libro de movimientos; mercado de la madera que cambia cada día;
compras de troncos con transporte y plazo; pedidos de clientes con fecha de entrega
(−25 % si llegan tarde); salarios por hora de turno; energía (más velocidad = más consumo);
mantenimiento preventivo (160 €) frente a averías (2 400 € y 4 h de reparación).

**Robots:** 9 brazos de 6 ejes en 4 celdas redundantes y un paletizador de 4 ejes. Las
trayectorias salen de la cinemática inversa (`shared/ik.js`) con las mismas cotas que los
modelos `.glb`, así que robot y pieza van sincronizados. Paquete de cables dinámico,
armario controlador con consola de programación, canaleta por el suelo, baliza de celda y
anillo de estado. La velocidad de cada robot (50–130 %) se elige en Administración y
afecta al ciclo, al calor y al desgaste.

**AGV:** rutas A* sobre la rejilla de la planta, entrada recta a los puntos de carga,
escáner de seguridad (se detienen si hay otro delante), replanificación si se bloquean,
pasillo del almacén exclusivo y supervisión de tráfico. Batería y carga en su base.

## Modo edición

En el visor, **Editar planta** (pide el usuario de gerencia): arrastra cualquier sección
(rejilla de 1 m), **R** gira 90°, flechas mueven (⇧ = 5 m). En vivo se reenruta la cinta
entre estaciones y se valida que todo esté dentro de la nave, sin solapes, que la cinta
pueda unir las estaciones y que los AGV lleguen a todos los puntos de carga. Al aplicar,
la planta se reorganiza sin parar: los AGV recalculan rutas y entregan lo que llevaban.

## Gemelo digital de los brazos

| Símbolo | En el código (`shared/sim/twin.js`) |
|---|---|
| S<sub>t</sub> estado | desgaste de reductora/servo, temperatura de bobinado |
| O<sub>t</sub> observaciones | corriente, temperatura medida, alarmas |
| U<sub>t</sub> control | velocidad (gerencia), reparto de carga, aceleración reducida, paradas |
| D<sub>t</sub> calibración | R<sub>th</sub> estimada, I²t |
| Q<sub>t</sub> previsión | vida útil restante (RUL), *what-if* de parar un brazo o reducir aceleración |

Térmico de primer orden y desgaste tipo Arrhenius (se duplica cada +10 °C, crece con el
ciclo y con v²). Quince minutos después de cada cambio de turno el gemelo propone un
mantenimiento preventivo por celda (si el resto puede asumir el trabajo sin pasar de
temperatura) o reducir la aceleración; el jefe de turno lo aprueba desde su móvil, el
técnico autoriza la parada en la HMI y el PLC reparte el trabajo.

Resultado de `tests/twin-week-test.mjs` (una semana simulada):

| | Paradas no programadas | Simultáneas | Preventivos | Caja final |
|---|---|---|---|---|
| Con gemelo | 0 | 0 | 13 | ≈ 154 000 € |
| Sin gemelo | 7 | 3 | 0 | ≈ 122 000 € |

## Estructura

```
server/index.mjs        servidor HTTP + WebSocket (/ws), persistencia, modo desarrollo con Vite
shared/                 lo comparten servidor, navegador y pruebas
  config.js             especies, productos, rutas, funciones, turnos, puestos, costes
  zones.js              secciones en coordenadas locales (máquinas, puertos de AGV, puestos)
  layout.js             colocación → cinta autoenrutada, rejilla de navegación, validación
  nav.js                A* con suavizado, alcanzabilidad
  timeline.js           trayectorias de los brazos y estado de cada pieza en el ciclo
  products.js           piezas de cada mueble (pose tumbada y montada), colores
  ik.js, robotSpecs.js  cinemática inversa y cotas de los robots
  sim/world.js          mundo: reloj, línea, acciones con permisos, instantáneas
  sim/{staff,economy,logistics,twin,hub}.js
src/net/client.js       conexión (WebSocket o simulación local) + store
src/viewer/             visor 3D (escena, robots, AGV, personas, HUD, modo edición)
src/admin/              aplicación de administración
src/app/                app móvil (PWA: public/app/manifest.webmanifest y sw.js)
scripts/generate-robots.mjs   genera los .glb de los robots
tests/                  pruebas de simulación
```
