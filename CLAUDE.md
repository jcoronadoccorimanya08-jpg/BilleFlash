# BilleFlash — guía para Claude

PWA personal de plata: anotar gastos en segundos, límite diario, cuentas en Bs y soles, deudas con cuotas y pagos que se repiten. Se usa en un Android, instalada desde Chrome. Independiente de Val Q y Bitácora: no compartas código en tiempo de ejecución ni datos.

## Privacidad: reglas que no se rompen

- **El repositorio y el sitio son públicos.** Nunca pongas en el código, en los commits ni en los issues datos de la persona: montos, nombres de personas, bancos propios, deudas, pagos, fechas personales ni respaldos. Los valores por defecto van sin montos.
- Lo personal entra **solo desde el teléfono**: a mano o con un archivo de inicio (`kind: 'config'`) que nunca se sube (`.gitignore` bloquea los nombres habituales).
- Las tres apps comparten el mismo sitio (mismo origen): todas las llaves de guardado empiezan con `billeflash.` y la base IndexedDB es `billeflash-v1`. Nunca leas ni borres llaves de otra app.
- Los datos se guardan **solo cifrados** (`src/lib/vault.ts`), con patrón (PBKDF2) y opcionalmente huella (passkey con PRF). Sin cifrar solo tema y apariencia (`billeflash.theme`, `billeflash.look`) y el aviso de instalación.
- Sin analítica ni librerías externas: la única conexión a internet es la sincronización cifrada (abajo). «Cobrar por WhatsApp» solo abre un enlace `wa.me` con el texto; la persona elige a quién mandarlo.
- **Sincronización celular ↔ tablet** (`src/lib/sync.ts`, `src/lib/syncSetup.ts`, pedido de la persona): con un código de sincronización (5 palabras + número, guardado solo dentro de los datos cifrados), el estado se cifra en el dispositivo (PBKDF2 + AES-GCM, llave derivada del código) y se guarda en Supabase (`atusufrroqtbbuffzjrw`) por funciones `put_blob`/`get_blob` que no permiten listar. El servidor solo ve texto ilegible. Un dispositivo recién vinculado nunca pisa la nube: si ya tiene datos propios, pregunta cuáles se quedan y guarda una copia cifrada para «Deshacer» (14 días). Antes de subir siempre mira la nube; si los dos cambiaron, se juntan (`src/lib/merge.ts`, con la última versión en común guardada cifrada en `<app>.sync-base`). Única llamada a internet permitida; la llave pública (publishable) puede estar en el código, la secreta nunca.
- **Widget (app «Rachas»)** (`src/lib/widget.ts`): por postMessage, solo dentro del teléfono, se manda racha, montaña, gastado/límite, disponible, días a la quincena y lo urgente en corto. En **modo discreto** (`settings.discreet`) van sin montos.

## Reglas del producto

- Interfaz en **español de Bolivia**, directo y respetuoso. **Sin culpa**: pasarse del límite es información.
- **El día cambia a las 00:00** de La Paz (`appDay`, pedido de la persona). Si se te pasó, «ayer» todavía se puede cerrar de 00:00 a 03:59 (`graceDay`, vale 75 %).
- **Racha de la noche**: sube con «Cerrar mi día». Antes de medianoche vale 100 %; cerrar «ayer» de 00:00 a 03:59, 75 %. Cada gasto olvidado (marcado o agregado después de cerrar) resta 15 %, mínimo 10 %. Sin cerrar a las 4:00: 0 % y corta. Hoy sin cerrar no corta. La montaña dibuja ese %.
- **Quincena**: al registrarla, el ahorro se aparta solo a la cuenta de ahorro. Límite diario **fijo** = (quincena − ahorro) ÷ días (15). Lo que sobra o falta pasa a la siguiente (`carry`).
- **Capital** = en mano + me deben − debo, en Bs con el tipo de cambio (variable, lo escribe la persona). Cada cierre guarda una foto (`shots`).
- **Deudas** en su moneda, nunca se cruzan solas; plan de cuotas opcional (`nextInstallment`).
- **Pagos**: mensuales (con `nextDue`, cuenta meses atrasados) o «cuando llega el recibo». `source: 'depa'` no sale de las cuentas propias. «Quitar» no borra: pasa a «Pagos quitados» (`removedBills`) y se recupera con su historial.
- **Moneda principal** (`settings.mainCurrency`, sin dato = Bs): límite, capital y gráficas en esa moneda (`toMain`, `money()` usa la principal).
- **Plata sin fecha fija** (`incomeMode: 'libre'`): límite diario fijo (`dailyLimit`) y cada plata que entra aparta solo su % (`savingPct`) a la alcancía (`kept`).
- **Alcancía** (`piggyMoves`, `piggyStats`): cada depósito con fecha y hora, semana, mes y días seguidos ahorrando. Sin redondeos: cada centavo vale.
- **Modo entrenador** (`src/lib/coach.ts`): el resumen viaja por WhatsApp cifrado con un código de equipo (PBKDF2 + AES-GCM). Ella decide qué y cuándo comparte; el entrenador lo abre en «Mi equipo» y le devuelve retos cifrados. Sin servidores.
- **Movimientos** (`src/lib/movements.ts`, Cuentas → 📜): todo lo que entró y salió por cuenta y mes, armado con lo guardado; cada uno se deshace (la plata vuelve a su cuenta; un pago fijo vuelve a quedar pendiente). Cuadrar a mano queda anotado (`adjusts`). Los pagos fijos y de deudas del día se ven en Hoy pero **no cuentan para el límite**. Un pago fijo puede cubrir varios meses (`months`). Al juntar, los saldos y lo apartado se suman (`additive: balance, saved`).
- Anotar un gasto debe tomar menos de 5 segundos; los botones miden 48 px o más.

## Reglas técnicas

- Fechas siempre en `America/La_Paz` (`src/lib/dates.ts`). Nunca `toISOString().slice(0, 10)` sobre la hora actual.
- Reglas en `src/lib/engine.ts` como funciones puras con pruebas en `tests/` (se pasa `now`). Si cambias una regla, cambia la prueba.
- Estado con `schema: 1`, validado en `src/lib/sanitize.ts`. Si cambias el formato, sube `schema` y migra. Nunca pierdas datos.
- Respaldo: archivo `.txt`, con compartir, guardar y copiar.
- Estilos: tokens de `src/styles/app.css` (sección «BilleFlash»).
- Antes de entregar: `npm run check`. El push a `main` publica en GitHub Pages (`/BilleFlash/`).
