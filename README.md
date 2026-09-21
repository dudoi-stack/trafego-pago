# Gestor de Tráfego Pago

App local, offline, para controle de criativos de tráfego pago (Meta Ads → Shopee afiliados).
V1 roda no **Windows e no macOS**: dois cliques abrem o navegador no painel; dados em SQLite fora do executável.

> Fase 0 (este commit): esqueleto executável — servidor local + `/api/health` + página embutida + SQLite. Go/No-Go do projeto.

## Requisitos (desenvolvedor)

- [Bun](https://bun.sh) 1.2+ (runtime, testes e empacotamento). Nada mais: zero dependências npm de produção.

## Rodar em dev

```sh
bun install
bun run embed      # gera src/server/assets.ts a partir de src/web/
bun run dev        # http://127.0.0.1:4173 (porta ocupada → próxima)
```

Dados de dev ficam no caminho do SO (`%APPDATA%\GestorTrafego\`, `~/Library/Application Support/GestorTrafego/`).
Para isolar, use `GESTOR_DATA_DIR=./dados bun run dev`. Para não abrir o navegador: `GESTOR_NO_BROWSER=1`.

## Testes e typecheck

```sh
bun test              # contrato HTTP em tests/api.test.ts (seam 2 da spec)
bunx tsc --noEmit     # typecheck
```

Seams de teste (spec #6): (1) módulo de cálculo puro — chega na Fase 1; (2) contrato HTTP por rota — este esqueleto cobre `GET /api/health`.

## Gerar o executável

```sh
bun run build
```

Saída em `dist/`: `GestorTrafego.exe` (Win x64), `GestorTrafego-macos-arm64/x64` + `LEIA-ME.txt`.
Teste em máquina limpa (sem Bun/Node): duplo clique abre o navegador e cria `gestor.db` na pasta de dados.

## Segunda instância

Abrir de novo **não** duplica o servidor: o boot sonda `/api/health` em `127.0.0.1` (4173→4182) e lê `gestor.lock`; se achar vida, só abre o navegador e sai.

## Layout

- `src/server/` — `index.ts` (boot), `app.ts` (Bun.serve), `db.ts` (SQLite + migrações), `paths.ts`, `browser.ts`, `assets.ts` (gerado)
- `src/server/migrations/001_init.sql` — esqueleto (schema_migrations + settings); domínio chega na Fase 1
- `src/web/index.html` — painel placeholder da Fase 0 (embutido no exe via `scripts/embed-assets.ts`)
- `tests/api.test.ts` — contrato `/api/health`
