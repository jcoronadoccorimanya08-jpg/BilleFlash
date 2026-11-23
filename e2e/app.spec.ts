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
  await page.getByRole('button', { name: /Bs por 1 sol/ }).click();
  await page.getByLabel('Cuántos Bs vale 1 sol').fill('4');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.bf-cap-main b')).toHaveText('Bs 390');

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
  await expect(page.locator('.bf-shot').nth(1)).toContainText('Bs 360');
});
