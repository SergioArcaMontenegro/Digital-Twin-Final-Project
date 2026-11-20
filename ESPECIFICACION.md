# Especificación · Gemelo Digital de una planta de transformación de madera

> Versión mejorada del encargo: «mejora los robots, añade un modo edición para mover las
> celdas, que la madera cambie de forma en su proceso, que haya dinero, compras de madera y
> destino de la madera (tablones, sillas, mesas…), una app móvil por operario según su
> función y una app de administrador que asigne trabajadores y la velocidad de los robots».

## 1. Objetivo

Un gemelo digital **jugable y coherente** de una fábrica de muebles de madera: la planta 3D,
la economía, los pedidos, la plantilla y las apps comparten **un único estado** que calcula
un servidor. Lo que hace el administrador en su app o un operario en el móvil se ve al
instante en la planta 3D, y al revés.

## 2. Arquitectura

| Pieza | Ruta | Para quién |
|---|---|---|
| Servidor de simulación (Node + WebSocket) | — | Calcula la planta, la economía y la plantilla; guarda el estado en disco |
| Visor 3D del gemelo | `/` | Jefe de planta / proyector de la sala de control |
| App de administración | `/admin` | Gerente (usuario `admin`) |
| App móvil de operario (PWA instalable) | `/app` | Cada trabajador con su usuario y clave |

- Un solo contenedor Docker sirve las tres webs y el WebSocket; el estado se guarda en un
  volumen (`/data/estado.json`) y sobrevive a reinicios.
- La simulación usa **un único reloj** (1× a 600×): producción, desgaste, turnos, salarios y
  pedidos avanzan juntos, así la economía cuadra con lo que se ve.

## 3. Proceso y productos

Productos y ruta por defecto (el administrador puede activar/desactivar estaciones por
orden de fabricación, p. ej. tablones sin lijar o mesas sin barnizar):

| Producto | CEP | CNC | LIJ | ENS | BAR | PAL | Tablas que consume |
|---|---|---|---|---|---|---|---|
| Lote de tablones | ✓ | — | ✓ | — | — | ✓ | 4 |
| Silla | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 2 |
| Mesa | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 4 |
| Estantería | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 3 |

**La madera cambia de forma en cada fase:** tronco (con corteza) → tablas verdes → pila
seca → tablas cepilladas / tablero encolado → **piezas mecanizadas** (patas, asiento,
respaldo, tablero, baldas…) que aparecen al cortar → piezas lijadas → **el robot coge cada
pieza y la coloca en su sitio** hasta formar la silla/mesa/estantería → barniz del tono del
pedido → palé del producto → camión.

Especies: **pino, haya, roble y nogal**, con su color, precio y factor de venta.

## 4. Economía

- Caja de la empresa con libro de movimientos (ingresos y gastos por categoría).
- **Compras de madera:** precio de mercado por especie (fluctúa), pedido de N troncos,
  coste de transporte, plazo de entrega; llega un camión al patio y el pórtico lo descarga.
- **Pedidos de clientes:** llegan solos (cliente, producto, especie, cantidad, precio,
  fecha límite). Se aceptan o rechazan; aceptar crea la orden de fabricación. Retraso = −25 %.
- **Plan de producción:** cola priorizable de órdenes (para pedido o para stock) con su ruta
  de estaciones y tono de barniz. El stock de producto terminado sirve a pedidos nuevos.
- Gastos: madera, salarios por hora de turno, energía (los robots más rápidos consumen más),
  mantenimiento preventivo y correctivo (las averías salen mucho más caras).

## 5. Plantilla y apps

**Funciones:** gerente, jefe de turno, aserrador, cepillador, operador de mecanizado
(CNC+lijado), operador de montaje (ensamblaje+barnizado), logística, mantenimiento, comercial.
Tres turnos (mañana, tarde, noche). Un puesto sin cubrir detiene su zona.

**App de administración:** resumen económico y gráfico de caja · pedidos de clientes ·
plan de producción (prioridad y ruta) · compras y stock · plantilla (función, turno y
**zona a la que va cada trabajador**, altas con usuario y clave) · robots (velocidad por celda 50–130 %,
ritmo de línea, aprobación de mantenimiento, salud) · simulación.

**App móvil (según función):** inicio con lo fabricado por su zona en el turno y estado de
sus máquinas · pedidos y entregas que le afectan · tareas con acción (el técnico autoriza la
parada y cierra la OT; el aserrador recibe el camión de troncos; logística confirma la
expedición; el jefe de turno aprueba la decisión del gemelo; el comercial acepta pedidos) ·
incidencias · perfil. Si nadie actúa, el trabajador simulado de ese turno lo hace solo.

## 6. Modo edición del layout

Desde el visor 3D (con el usuario de gerencia): pausar, **arrastrar y girar** cada sección
(aserradero, secadero, cepillado, CNC, lijado, ensamblaje, barnizado, paletizado,
almacén, base de AGVs, sala de control) sobre una rejilla de 1 m. En vivo se recalculan la
**cinta transportadora** entre estaciones y las **rutas de los AGVs** (A* sobre la planta),
y se valida: dentro de la nave, sin solapes, cinta posible y todos los puntos de carga
alcanzables por los AGVs. Una distribución más compacta acorta la transferencia y mejora el
takt. Aplicar / cancelar / restaurar distribución por defecto.

## 7. Robots

Esqueleto más realista (fundiciones redondeadas, motores con freno, **paquete de cables
dinámico** que sigue al brazo, equilibrador, cambiador de herramienta), armario de control y
consola de programación por celda, trayectorias con aproximación/retirada y velocidad
controlada desde la app de administración (afecta al ciclo, al calor y al desgaste del
gemelo). AGVs con ruedas, LiDAR giratorio, balizas y trayectoria visible.

## 8. Criterios de aceptación

1. Una semana simulada sin gemelo provoca paradas simultáneas; con gemelo, ninguna.
2. Cualquier distribución válida del modo edición produce una planta que funciona
   (sin bloqueos permanentes de AGVs) — comprobado con distribuciones aleatorias.
3. La caja refleja compras, salarios, energía, mantenimiento y ventas.
4. Las tres apps muestran el mismo estado en tiempo real.

## 9. Estado de la implementación

Implementado tal cual, con estos ajustes surgidos al calibrar la simulación:

- **Paletizado con dos puestos de palé** (A y B): mientras el AGV-C retira uno enfardado, el
  robot llena el otro. Con uno solo, la línea se paraba en cada cambio de palé.
- **Velocidad por robot** (no solo por celda) y **reparto de carga** por robot.
- **Fabricación para stock** automática cuando el plan se queda sin trabajo (desactivable),
  y compras automáticas de troncos con colchón en el patio (desactivables).
- **Ofertas** caducan a las 14 h para que el comercial (jornada 08–17) pueda responder las
  que llegan por la tarde.
- La decisión del gemelo admite perder hasta un 35 % de ritmo en la celda durante los
  45 min de una parada preventiva: compensa frente a una avería de 4 h.
- **Usuarios:** solo existe la cuenta de gerencia (`digitaltwins` / `digitaltwins2026`); los
  trabajadores (usuario y clave) se crean en Administración → Plantilla. Los puestos vacíos
  los cubre personal simulado (desactivable).
- Sin servidor, cada página ejecuta su propia simulación local (modo demostración).

Criterios de aceptación comprobados con `npm test` y `tests/twin-week-test.mjs`:
1. Una semana sin gemelo: 7 paradas no programadas (3 simultáneas); con gemelo: 0.
2. Distribuciones aleatorias válidas siguen produciendo y ningún AGV queda atascado.
3. La caja cuadra con el libro de movimientos.
4. Las tres apps comparten el estado del servidor por WebSocket.
