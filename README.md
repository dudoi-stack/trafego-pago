# Gestor de Tráfego Pago

App local, offline, para controle de criativos de tráfego pago (Meta Ads → Shopee afiliados).
V1 roda no **Windows e no macOS**: dois cliques abrem o navegador no painel; dados em SQLite fora do executável.

Cadastro único e em lote, lançamento diário em lote, biblioteca com detalhe
réplica-da-planilha, dashboard de decisão com Sinal (régua + status + motivo),
imposto editável sem reescrever a história, backup/export — 100% offline,
valores em R$ no formato brasileiro (aceita `4,18` e `4.18`).

## Requisitos (desenvolvedor)

- [Bun](https://bun.sh) 1.2+ (runtime, testes e empacotamento). Nada mais: zero dependências npm de produção.

## Rodar em dev

```sh
bun install
bun run embed      # gera src/server/assets.ts a partir de src/web/
bun run dev        # http://127.0.0.1:4173 (porta ocupada → próxima)
```

Para ver o sistema sem prender o terminal: `bun run up` (sobe em segundo plano e mostra a URL) e `bun run down` (derruba).

Dados de dev ficam no caminho do SO (`%APPDATA%\GestorTrafego\`, `~/Library/Application Support/GestorTrafego/`).
Para isolar, use `GESTOR_DATA_DIR=./dados bun run dev`. Para não abrir o navegador: `GESTOR_NO_BROWSER=1`.

## Testes e typecheck

```sh
bun test              # 7 arquivos: cálculo puro (seam 1) + contrato HTTP por rota (seam 2) + seams do runtime (T1)
bun run typecheck     # tsc --noEmit
```

Seams de teste (spec #6): (1) módulo de cálculo puro em `tests/calc.test.ts`
(vetores da planilha real + travas do Sinal); (2) contrato HTTP por rota em
`tests/api.test.ts` (T2), `t3/t4/t5` e `t6` (entrega: offline, R$ BR,
backup-antes-de-migrar, LEIA-ME).

## Gerar o executável

```sh
bun run build
```

Saída em `dist/`: `GestorTrafego.exe` (Win x64), `GestorTrafego-macos-arm64/x64` + `LEIA-ME.txt` (3 passos).
Teste em máquina limpa (sem Bun/Node): duplo clique abre o navegador e cria `gestor.db` na pasta de dados.

## Atualizar sem medo

Feche o programa, troque **só o executável** e abra de novo. Ao abrir, o app
faz **backup-antes-de-migrar** automaticamente e migra o banco sozinho.
Backups diários (30 últimos) ficam na pasta `backups` ao lado do banco.

## Segunda instância

Abrir de novo **não** duplica o servidor: o boot sonda `/api/health` em `127.0.0.1` (4173→4182) e lê `gestor.lock`; se achar vida, só abre o navegador e sai.

## Layout

- `src/server/` — `index.ts` (boot), `app.ts` (rotas via `createRequestHandler` + `startServer`), `db.ts` (SQLite + migrações com backup-antes-de-migrar), `paths.ts`, `browser.ts`, `backup.ts`, `leia-me.ts`, `assets.ts` (gerado)
- `src/server/runtime/` — seams finas do runtime (T1): `database.ts` (persistência), `migrations.ts` (leitura dos SQLs), `calc-loader.ts` (cálculo ao-vivo), `http-server.ts` (servidor loopback), `process.ts` (navegador), `wait.ts` (espera)
- `src/server/migrations/` — `001_init.sql` (settings + schema_migrations), `002_domain.sql` (criativos + lançamentos)
- `src/shared/calc.ts` — módulo único de cálculo (servidor + navegador via `/shared/calc.js`, com bundle embutido no exe)
- `src/web/index.html` — interface (embutida no exe via `scripts/embed-assets.ts`; 100% offline, sem CDN)
- `tests/` — `calc.test.ts`, `api.test.ts`, `t3/t4/t5/t6.test.ts`, `seams.test.ts` (seams do runtime)
