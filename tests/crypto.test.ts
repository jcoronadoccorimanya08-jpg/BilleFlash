import { describe, expect, it } from 'vitest';
import { parseFile, serializeBackup } from '../src/lib/backup';
import {
  decryptBytes,
  decryptJSON,
  deriveKey,
  encryptBytes,
  encryptJSON,
  importDataKey,
  keyFromPrf,
  newDataKey,
  randomBytes,
  toB64,
} from '../src/lib/crypto';
import { sanitizeState } from '../src/lib/sanitize';
import { initialState } from '../src/lib/store';

const ITER = 1000; // iteraciones bajas solo para que las pruebas sean rápidas

describe('cifrado por sobre', () => {
  it('la llave de datos se abre con el patrón correcto y con la huella', async () => {
    const dk = newDataKey();
    const salt = randomBytes(16);
    const wrappedByPattern = await encryptBytes(await deriveKey('0-4-8-5', salt, ITER), dk);
    const prf = randomBytes(32);
    const wrappedByBio = await encryptBytes(await keyFromPrf(prf), dk);

    expect(await decryptBytes(await deriveKey('0-4-8-5', salt, ITER), wrappedByPattern)).toEqual(dk);
    expect(await decryptBytes(await keyFromPrf(prf), wrappedByBio)).toEqual(dk);
    await expect(decryptBytes(await deriveKey('0-1-2-5', salt, ITER), wrappedByPattern)).rejects.toBeTruthy();
    await expect(decryptBytes(await keyFromPrf(randomBytes(32)), wrappedByBio)).rejects.toBeTruthy();
  });

  it('los datos cifrados no muestran el contenido', async () => {
    const key = await importDataKey(newDataKey());
    const state = initialState({ startDate: '2026-11-08', debts: [{ id: 'd', dir: 'me-deben', person: 'Persona privada', currency: 'PEN', amount: 500, payments: [] }] });
    const sealed = await encryptJSON(key, state);
    expect(sealed.ct).not.toContain('privada');
    const back = sanitizeState(await decryptJSON(key, sealed));
    expect(back?.debts[0]?.person).toBe('Persona privada');
    expect(back?.accounts.length).toBe(3);
    // Fila N° 1 del historial: cómo empiezas.
    expect(back?.shots).toHaveLength(1);
    expect(back?.shots[0]?.date).toBe('2026-11-08');
  });

  it('cada guardado usa un vector distinto', async () => {
    const key = await importDataKey(newDataKey());
    const a = await encryptJSON(key, { x: 1 });
    const b = await encryptJSON(key, { x: 1 });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
});

describe('respaldos y archivo de inicio', () => {
  it('un respaldo en texto se lee de vuelta', async () => {
    const key = await importDataKey(newDataKey());
    const record = { v: 2 as const, lock: { pattern: { iter: ITER, salt: toB64(randomBytes(16)), wrapped: await encryptJSON(key, { x: 1 }) } }, data: await encryptJSON(key, { x: 1 }) };
    const f = parseFile(serializeBackup(record));
    expect(f.kind).toBe('backup');
  });

  it('lee el archivo de inicio y rechaza el de otra app', () => {
    const f = parseFile(
      JSON.stringify({
        app: 'billeflash',
        kind: 'config',
        rate: 3.45,
        quincena: { amount: 10, saving: 1, days: 15 },
        accounts: [{ id: 'monedas', name: 'Monedas', currency: 'BOB', kind: 'efectivo', balance: 5 }],
        debts: [{ dir: 'debo', person: 'X', currency: 'PEN', amount: 3 }],
        bills: [{ name: 'Internet', amount: 2, kind: 'mensual', nextDue: '2026-09-01' }],
      }),
    );
    expect(f.kind).toBe('config');
    if (f.kind === 'config') {
      expect(f.accounts?.[0]?.balance).toBe(5);
      expect(f.debts?.[0]?.dir).toBe('debo');
      expect(f.bills?.[0]?.nextDue).toBe('2026-09-01');
    }
    expect(() => parseFile(JSON.stringify({ app: 'bitacora', kind: 'config' }))).toThrow('no es de BilleFlash');
  });
});
