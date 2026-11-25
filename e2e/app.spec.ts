import { expect, test, type Page } from '@playwright/test';

const NIGHT = new Date('2026-11-23T21:00:00-04:00');
const PATTERN = [1, 2, 3, 6, 9];

async function draw(page: Page, dots: number[]) {
  const centers = [];
  for (const d of dots) {
    const box = await page.locator(`[data-dot="${d}"]`).first().boundingBox();
    if (!box) throw new Error(`sin punto ${d}`);
    centers.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  await page.mouse.move(centers[0]!.x, centers[0]!.y);
  await page.mouse.down();
  for (const c of centers.slice(1)) await page.mouse.move(c.x, c.y, { steps: 6 });
  await page.mouse.up();
}

async function createPattern(page: Page) {
  await expect(page.getByRole('heading', { name: 'Crea tu patrón' })).toBeVisible();
  await draw(page, PATTERN);
  await expect(page.getByRole('heading', { name: 'Repite tu patrón' })).toBeVisible();
  await draw(page, PATTERN);
}

const nav = (page: Page, name: string) => page.locator('nav.nav').getByRole('button', { name }).click();

/** Archivo de inicio de ejemplo (montos inventados). */
const START = JSON.stringify({
  app: 'billeflash',
  kind: 'config',
  rate: 3.5,
  quincena: { amount: 300, saving: 0, days: 15 },
  accounts: [
    { id: 'monedas', name: 'Monedas', currency: 'BOB', kind: 'efectivo', balance: 50 },
    { id: 'banco', name: 'Banco Uno', currency: 'BOB', kind: 'banco', balance: 100 },
    { id: 'soles', name: 'Banco Sol', currency: 'PEN', kind: 'banco', balance: 10 },
    { id: 'ahorro', name: 'Ahorro', currency: 'BOB', kind: 'ahorro', balance: 0 },
  ],
  debts: [
    { dir: 'me-deben', person: 'Ana', currency: 'PEN', amount: 100, plan: { amount: 20, everyDays: 7, start: '2026-11-23' } },
    { dir: 'debo', person: 'Beto', currency: 'PEN', amount: 50 },
  ],
  bills: [{ name: 'Internet', amount: 10, kind: 'mensual', nextDue: '2026-09-01', source: 'depa' }],
});

async function setupFromFile(page: Page) {
  await page.clock.install({ time: NIGHT });
  await page.goto('./');
  await page.getByRole('button', { name: 'Pegar el texto del archivo o de un respaldo' }).click();
  await page.getByPlaceholder('Pega aquí todo el texto').fill(START);
  await page.getByRole('button', { name: 'Abrir' }).click();
  await createPattern(page);
  await expect(page.getByRole('heading', { name: 'Hoy' })).toBeVisible();
}

test('desde cero: quincena, gasto, cierre a tiempo y protección con patrón', async ({ page }) => {
  await page.clock.install({ time: NIGHT });
  await page.goto('./');
  await page.getByRole('button', { name: 'Empezar desde cero' }).click();
  await page.getByLabel('Cuánto te llega cada quincena (Bs)').fill('300');
  await expect(page.getByText('Tu límite: Bs 20 por día')).toBeVisible();
  await page.getByRole('button', { name: 'Seguir' }).click();
  await createPattern(page);

  await page.getByLabel('Descripción').fill('Almuerzo');
  await page.getByLabel('Costo').fill('25');
  await page.getByRole('button', { name: 'Agregar gasto' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Almuerzo' })).toContainText('Bs 25');
  await expect(page.getByText('Te pasaste Bs 5')).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar mi día' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar mi día' }).click();
  await expect(page.getByText('Día cerrado · 100 %')).toBeVisible();
  await expect(page.getByLabel('Racha de 1 noches')).toBeVisible();

  // Lo que se agrega después de cerrar cuenta como olvidado.
  await page.getByLabel('Descripción').fill('Chicle');
  await page.getByLabel('Costo').fill('6');
  await page.getByRole('button', { name: 'Agregar gasto' }).click();
  await expect(page.getByText('Día cerrado · 85 %')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Dibuja tu patrón')).toBeVisible();
  await draw(page, [1, 4, 7, 8]);
  await expect(page.getByRole('alert')).toHaveText('Patrón incorrecto.');
  await draw(page, PATTERN);
  await expect(page.getByRole('row').filter({ hasText: 'Chicle' })).toContainText('olvidado');
});

test('archivo de inicio: capital, quincena con ahorro, cobros y pagos atrasados', async ({ page }) => {
  await setupFromFile(page);
  await expect(page.getByText('Internet: debes 3 meses (Bs 30)')).toBeVisible();
  await expect(page.getByText('Cobrar a Ana S/ 20: hoy')).toBeVisible();

  await nav(page, 'Cuentas');
  // 50 + 100 + 10×3,5 = 185 en mano; te deben 350; debes 175 → 360.
  await expect(page.locator('.bf-cap-main b')).toHaveText('Bs 360');
  await page.getByRole('button', { name: /Bs = 1 S\//  }).click();
  await page.getByLabel('Cuántos Bs vale 1 sol').fill('4');
  await page.getByLabel('Cuántos soles vale 1 dólar').fill('2');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.bf-cap-main b')).toHaveText('Bs 390');
  // 390 Bs ÷ 4 = S/ 97,50 ÷ 2 = $ 48,75
  await expect(page.locator('.bf-cap-other')).toContainText('S/ 97,5');
  await expect(page.locator('.bf-cap-other')).toContainText('$ 48,75');

  await nav(page, 'Hoy');
  await page.getByRole('button', { name: 'Entró plata' }).click();
  await page.getByLabel('Monto (Bs)').fill('300');
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('Disponible en la quincena: Bs 300')).toBeVisible();

  await nav(page, 'Deudas');
  const ana = page.locator('.bf-debt').filter({ hasText: 'Ana' });
  await expect(ana.getByRole('link', { name: 'Cobrar por WhatsApp' })).toHaveAttribute('href', /wa\.me\/\?text=Hola%20Ana/);
  await ana.getByRole('button', { name: 'Me pagó' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await expect(ana).toContainText('S/ 80');
  await expect(ana).toContainText('Próxima cuota: S/ 20 · el 30 nov');
  // El cobro entró a una cuenta (efectivo): tu capital no cambia (390 + la quincena de 300).
  await nav(page, 'Cuentas');
  await expect(page.locator('.bf-cap-main b')).toHaveText('Bs 690');
  await expect(page.locator('.bf-acc').filter({ hasText: 'Monedas' })).toContainText('Bs 130');

  await nav(page, 'Pagos');
  const internet = page.locator('.bf-bill').filter({ hasText: 'Internet' });
  await expect(internet).toContainText('Atrasado: 3 meses');
  await internet.getByRole('button', { name: 'Pagar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Pagado' }).click();
  await expect(internet).toContainText('Atrasado: 2 meses');
});

test('día cerrado de madrugada vale 75 % y la montaña lo muestra', async ({ page }) => {
  await setupFromFile(page);
  await page.clock.setFixedTime(new Date('2026-11-24T02:30:00-04:00'));
  await page.reload();
  await draw(page, PATTERN);
  await expect(page.getByText('lunes 23 de noviembre')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar mi día' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar mi día' }).click();
  await expect(page.getByText('Día cerrado · 75 %')).toBeVisible();
  await nav(page, 'Avance');
  await expect(page.locator('.tile').filter({ hasText: 'Noches seguidas' })).toContainText('1');
  // Tabla como el Excel: N° 1 al empezar y N° 2 al cerrar; «Anotar mi capital ahora» agrega otra.
  const rows = page.locator('.bf-hist tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Bs 360');
  await expect(rows.last()).toContainText('inicio');
  await page.getByRole('button', { name: 'Anotar mi capital ahora' }).click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('+Bs 0');
});

test('metas de ahorro: la quincena reparte el ahorro y los favoritos anotan de un toque', async ({ page }) => {
  await setupFromFile(page);
  await nav(page, 'Cuentas');
  await page.getByRole('button', { name: 'Nueva meta' }).click();
  await page.getByLabel('Para qué').fill('Fondo');
  await page.getByLabel('Cuánto quieres juntar').fill('100');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.bf-goal')).toContainText('⭐ Fondo');
  await page.getByRole('button', { name: 'Avance' }).click();
  await page.getByLabel('Cuánto va al ahorro (Bs)').fill('30');
  await page.locator('section', { has: page.getByLabel('Cuánto va al ahorro (Bs)') }).getByRole('button', { name: 'Guardar' }).click();
  await nav(page, 'Hoy');
  await page.getByRole('button', { name: 'Entró plata' }).click();
  await page.getByLabel('Monto (Bs)').fill('300');
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await nav(page, 'Cuentas');
  await expect(page.locator('.bf-goal')).toContainText('Bs 30 de Bs 100 · 30 %');

  // Dos veces lo mismo → aparece como favorito.
  await nav(page, 'Hoy');
  for (let i = 0; i < 2; i++) {
    await page.getByLabel('Descripción').fill('Pasaje');
    await page.getByLabel('Costo').fill('3');
    await page.getByRole('button', { name: 'Agregar gasto' }).click();
  }
  await page.getByRole('button', { name: '+ Pasaje Bs 3' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Pasaje' })).toHaveCount(3);
  await expect(page.getByRole('row').filter({ hasText: 'Pasaje' }).first()).toContainText('Pasaje · Monedas');
  await nav(page, 'Avance');
  await expect(page.locator('.bf-cat-row').filter({ hasText: 'Pasaje' })).toContainText('Bs 9');
});

test('modo hermana: soles, «me dieron» con 10 % a la alcancía, monedas y resumen cifrado para el entrenador', async ({ page }) => {
  await page.clock.install({ time: NIGHT });
  await page.goto('./');
  await page.getByRole('button', { name: 'Pegar el texto del archivo o de un respaldo' }).click();
  await page.getByPlaceholder('Pega aquí todo el texto').fill(
    JSON.stringify({
      app: 'billeflash',
      kind: 'config',
      nick: 'Ana',
      mainCurrency: 'PEN',
      incomeMode: 'libre',
      dailyLimit: 3,
      savingPct: 10,
      accent: 'vino',
      remindAt: '22:00',
      accounts: [
        { id: 'efectivo', name: 'Mi plata', currency: 'PEN', kind: 'efectivo', balance: 0 },
        { id: 'alcancia', name: 'Alcancía', currency: 'PEN', kind: 'ahorro', balance: 0 },
      ],
      goals: [{ name: 'Cursos', target: 300, saved: 0, main: true }],
    }),
  );
  await page.getByRole('button', { name: 'Abrir' }).click();
  await createPattern(page);
  await expect(page.getByRole('heading', { name: 'Hola, Ana' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'vino');
  await expect(page.locator('.bf-limit')).toContainText('S/ 3');

  await page.getByRole('button', { name: 'Me dieron plata' }).click();
  await page.getByLabel('Monto (S/)').fill('7');
  await expect(page.getByText('Apartar 10 % a mi alcancía (S/ 0,7)')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Registrar' }).click();
  await page.getByRole('button', { name: '+ S/ 2' }).click();
  await expect(page.locator('.bf-piggy b')).toHaveText('S/ 2,7');
  await page.getByLabel('Descripción').fill('Raspadilla');
  await page.getByLabel('Costo').fill('1,5');
  await page.getByRole('button', { name: 'Agregar gasto' }).click();

  // Su resumen, cifrado con el código del equipo.
  await nav(page, 'Avance');
  await page.getByLabel('Código de equipo (el mismo que tu entrenador)').fill('codigo secreto');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Mandar mi resumen a mi entrenador' }).click()]);
  const text = await (await import('node:fs/promises')).readFile((await dl.path())!, 'utf-8');
  expect(text).not.toContain('Raspadilla');

  // El entrenador lo abre en su equipo (aquí, en la misma app, para la prueba).
  await page.getByRole('button', { name: 'Agregar a mi equipo' }).click();
  await page.getByLabel('Nombre').fill('Ana');
  await page.getByLabel('Código de equipo (el mismo que ella puso)').fill('codigo secreto');
  await page.getByRole('dialog').getByRole('button', { name: 'Agregar' }).click();
  const member = page.locator('.bf-member');
  await member.getByRole('button', { name: 'Pegar texto' }).click();
  await member.getByPlaceholder('Pega aquí el texto del resumen').fill(text);
  await member.getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(member).toContainText('Raspadilla');
  await expect(member).toContainText('🐷 S/ 2,7');
  await expect(member).toContainText('Cursos: S/ 2,7 de S/ 300');
});

test('pagar 2 meses de una vez, verlo en Hoy y en Movimientos, y deshacerlo', async ({ page }) => {
  await setupFromFile(page);
  await nav(page, 'Pagos');
  const internet = page.locator('.bf-bill').filter({ hasText: 'Internet' });
  await expect(internet).toContainText('Atrasado: 3 meses');
  await internet.getByRole('button', { name: 'Pagar' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('radio', { name: '2 meses' }).click();
  await expect(sheet.getByLabel('Monto (Bs)')).toHaveValue('20');
  await sheet.getByLabel('De dónde salió').selectOption({ label: 'Monedas (Bs) · Bs 50' });
  await sheet.getByRole('button', { name: 'Pagado' }).click();
  await expect(internet).toContainText('Atrasado: 1 mes');

  // En Hoy se ve, pero no cuenta para el límite.
  await nav(page, 'Hoy');
  await expect(page.locator('.bf-tr.fixed')).toContainText('Internet (2 meses)');

  // En Movimientos: de qué cuenta salió, y se deshace.
  await nav(page, 'Cuentas');
  await expect(page.locator('.bf-acc').filter({ hasText: 'Monedas' })).toContainText('Bs 30');
  await page.getByRole('button', { name: /Movimientos/ }).click();
  const row = page.locator('.mv-item').filter({ hasText: 'Internet (2 meses)' });
  await row.getByRole('button').first().click();
  await expect(row).toContainText('Salió de Monedas: Bs 20');
  await row.getByRole('button', { name: /Deshacer/ }).click();
  await page.locator('dialog[open]').last().getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('.mv-item').filter({ hasText: 'Internet' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.bf-acc').filter({ hasText: 'Monedas' })).toContainText('Bs 50');
  await nav(page, 'Pagos');
  await expect(internet).toContainText('Atrasado: 3 meses');

  // Cuadrar a mano queda anotado.
  await nav(page, 'Cuentas');
  await page.locator('.bf-acc').filter({ hasText: 'Monedas' }).click();
  await page.getByLabel('Lo que de verdad tienes (Bs)').fill('47');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: /Movimientos/ }).click();
  await expect(page.locator('.mv-item').filter({ hasText: 'Cuadre a mano' })).toContainText('−Bs 3');
});
