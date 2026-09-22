// tests/support/parity.ts — T4 Paridade de testes nos dois runtimes.
//
// Fonte única dos 71 cenários de domínio (api, calc, t3, t4, t5, t6):
// os testes importam `describe/test/afterEach/expect` daqui, nunca de
// `bun:test` direto — o mesmo arquivo roda no `bun test` (padrão) e no
// `node --test` (legacy, após compilação), com as mesmas asserções.
//
// - `describe/test/afterEach`: re-export de `node:test`
//   (o Bun executa `node:test` no `bun test`; o Node no `node --test`).
// - `expect`: adaptador fino com a mesma semântica nos dois runtimes
//   (jest/bun-like). Não usa `bun:test` para que a compilação não precise
//   reescrever o import e o verde signifique a mesma coisa nos dois lados.
//   Cobre só o que os 71 cenários usam (sem `resolves/rejects`).
//   O mesmo `expect` roda nos dois lados — divergência de domínio vira vermelho.
import { strict as nodeAssert } from "node:assert";
import { afterEach, describe, test } from "node:test";

export { afterEach, describe, test };

function fmt(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function isRegExp(v: unknown): v is RegExp {
  return v instanceof RegExp;
}

function deepEqual(a: unknown, b: unknown): boolean {
  try {
    nodeAssert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

function subsetMatch(actual: unknown, expected: unknown): boolean {
  if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
    for (const [k, v] of Object.entries(expected as Record<string, unknown>)) {
      if (!subsetMatch((actual as Record<string, unknown>)[k], v)) return false;
    }
    return true;
  }
  return deepEqual(actual, expected);
}

function checkNumber(
  actual: unknown,
  expected: number,
  matcher: string,
  cmp: (a: number, e: number) => boolean,
  check: (pass: boolean, matcher: string, expected: unknown) => void,
): void {
  check(typeof actual === "number" && cmp(actual, expected), matcher, expected);
}

interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toMatch(expected: string | RegExp): void;
  toMatchObject(expected: Record<string, unknown>): void;
  toHaveLength(expected: number): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeCloseTo(expected: number, precision?: number): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  not: Matchers;
}

export function expect(actual: unknown): Matchers {
  function fail(matcher: string, expected: unknown, extra?: string): never {
    const base = `expect(${fmt(actual)}).${matcher}(${fmt(expected)}) falhou`;
    throw new Error(extra ? `${base} — ${extra}` : base);
  }

  function make(negated: boolean): Matchers {
    function check(pass: boolean, matcher: string, expected: unknown, extra?: string): void {
      if (negated ? pass : !pass) fail(`${negated ? "not." : ""}${matcher}`, expected, extra);
    }

    const m = {
      toBe(expected: unknown): void {
        check(Object.is(actual, expected), "toBe", expected);
      },
      toEqual(expected: unknown): void {
        check(deepEqual(actual, expected), "toEqual", expected);
      },
      toContain(expected: unknown): void {
        let pass = false;
        if (typeof actual === "string" && typeof expected === "string") {
          pass = actual.includes(expected);
        } else if (Array.isArray(actual)) {
          pass = actual.some((item) => Object.is(item, expected) || deepEqual(item, expected));
        }
        check(pass, "toContain", expected);
      },
      toMatch(expected: string | RegExp): void {
        let pass = false;
        if (typeof actual === "string") {
          pass = isRegExp(expected) ? expected.test(actual) : actual.includes(expected);
        }
        check(pass, "toMatch", expected);
      },
      toMatchObject(expected: Record<string, unknown>): void {
        check(subsetMatch(actual, expected), "toMatchObject", expected);
      },
      toHaveLength(expected: number): void {
        const len = (actual as { length?: unknown })?.length;
        check(len === expected, "toHaveLength", expected, `length real: ${fmt(len)}`);
      },
      toBeDefined(): void {
        check(actual !== undefined, "toBeDefined", undefined);
      },
      toBeUndefined(): void {
        check(actual === undefined, "toBeUndefined", undefined);
      },
      toBeNull(): void {
        check(actual === null, "toBeNull", null);
      },
      toBeCloseTo(expected: number, precision = 2): void {
        const pass =
          typeof actual === "number" &&
          typeof expected === "number" &&
          Math.abs(actual - expected) < Math.pow(10, -precision) / 2;
        check(pass, "toBeCloseTo", expected, `precisão ${precision}, diff ${typeof actual === "number" ? Math.abs(actual - (expected as number)) : "n/a"}`);
      },
      toBeGreaterThan(expected: number): void {
        checkNumber(actual, expected, "toBeGreaterThan", (a, e) => a > e, check);
      },
      toBeGreaterThanOrEqual(expected: number): void {
        checkNumber(actual, expected, "toBeGreaterThanOrEqual", (a, e) => a >= e, check);
      },
      toBeLessThan(expected: number): void {
        checkNumber(actual, expected, "toBeLessThan", (a, e) => a < e, check);
      },
      toBeLessThanOrEqual(expected: number): void {
        checkNumber(actual, expected, "toBeLessThanOrEqual", (a, e) => a <= e, check);
      },
    } satisfies Omit<Matchers, "not">;
    // `not` preguiçoso: cria o negado só no acesso (evita recursão infinita
    // na criação — o verde usa um nível de `not`, o `not.not` volta ao base).
    return { ...m, get not(): Matchers { return make(!negated); } };
  }

  return make(false);
}
