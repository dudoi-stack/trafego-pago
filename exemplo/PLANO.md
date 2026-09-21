# Gestor de Tráfego Pago — Plano de construção

Sistema para substituir a planilha manual de criativos (Meta Ads → Shopee afiliados). Este arquivo é o guia para construir o projeto pela CLI, fase por fase.

## 0. Como usar este arquivo

1. Crie a pasta do projeto e coloque este arquivo nela como `PLANO.md`.
2. Salve o protótipo visual como `docs/prototipo-ui.html` (é a referência exata de layout, cores e comportamento).
3. Abra o Claude Code na pasta e cole o prompt abaixo.
4. Trabalhe **uma fase por vez**. Ao fim de cada fase, rode os testes e confira os critérios "Pronto quando" antes de seguir.

**Prompt inicial para colar na CLI:**

> Leia o `PLANO.md` inteiro e o `docs/prototipo-ui.html`. Antes de escrever código, me diga em 5 linhas o que entendeu e quais dúvidas tem. Depois execute somente a **Fase 0** e pare para eu validar. Regras: interface em pt-BR; nomes de código e colunas em inglês; nenhuma dependência de rede em tempo de execução (o sistema roda offline); sempre escreva testes para as regras de cálculo.

---

### Como usar o protótipo (`docs/prototipo-ui.html`)

É um arquivo único com dados de exemplo em memória, feito para validar visual e comportamento.

**Aproveitar:** o CSS (tokens de cor, tipografia, componentes), a régua de ROAS (`ruler`), o gráfico SVG (`drawChart`), os textos em pt-BR, o layout de cada tela e os fluxos (filtros, edição ao vivo na planilha, lançamento em lote, cadastro em lote).

**Não copiar como está:**
- Os dados de exemplo (`seed()`) e o estado em memória (`state`): no sistema real os dados vêm da API.
- O `<link>` do Google Fonts: trocar por arquivos `.woff2` locais.
- O arquivo único: separar em módulos conforme a seção 4.
- As funções de cálculo (`calcRow`, `agg`, `decisionOf`, `bandOf`): elas mostram a regra, mas a versão oficial passa a ser `src/shared/calc.js`, com dinheiro em centavos (o protótipo usa reais em decimal).
- A data fixa `TODAY = '2026-09-20'`: no sistema real usar a data do computador.
- Os botões de backup, exportar e importar em Configurações: no protótipo eles só mostram um aviso.

## 1. Contexto

- **Quem usa:** criador de conteúdo, sem conhecimento técnico. Lança ~5 ou mais criativos novos por dia.
- **Problema:** hoje cada criativo tem uma tabela própria na planilha. Não escala.
- **Meta:** cadastrar criativos rápido, lançar os números do dia de todos de uma vez, e decidir (escalar, manter, pausar) olhando um dashboard.
- **Restrição principal:** o usuário final **não instala nada além de abrir o programa**.

## 2. O que a planilha atual faz (regras a preservar)

Colunas por dia: Data · Investimento · Imposto · Vendas · Faturamento · Lucro · Cliques Meta · Cliques Shopee · CPC Meta · CPC Shopee · ROAS.

| Coluna | Origem | Regra |
|---|---|---|
| Investimento | digitado | R$ gasto no Meta no dia |
| **Imposto** | calculado | `investimento × (1 + 13,86%)`. **Atenção:** não é só o imposto, é o custo já com imposto. Na interface chame de **"Custo c/ imposto"** |
| Vendas | digitado | quantidade |
| Faturamento | digitado | R$ de comissão |
| Lucro | calculado | `faturamento − custo c/ imposto` |
| Cliques Meta / Shopee | digitados | quantidade |
| CPC Meta / Shopee | calculado | `investimento ÷ cliques` (usa investimento **sem** imposto) |
| ROAS | calculado | `faturamento ÷ custo c/ imposto` |
| Linha TOTAL | calculado | somas de tudo. **ROAS total = Σ faturamento ÷ Σ custo**, nunca a média dos ROAS diários |

**Cores do ROAS na planilha (viram as faixas de decisão):**

| ROAS | Cor | Ação sugerida |
|---|---|---|
| menor que 1,00 | vermelho | Pausar (dá prejuízo) |
| 1,00 a 1,20 | amarelo | Observar (margem baixa) |
| 1,20 a 1,60 | azul | Manter |
| 1,60 ou mais | verde | Escalar |

Lucro: verde se positivo, vermelho se negativo.

**Problemas da planilha que o sistema deve resolver:**

1. **Faturamento chega depois.** No arquivo enviado há 69 vendas e faturamento zerado: a comissão só é confirmada dias depois. Zero na planilha vira "ROAS 0 → pausar", o que é falso. **Regra nova:** faturamento vazio (`NULL`) significa "pendente". Dias pendentes contam no investimento, mas ficam **fora do lucro e do ROAS** até serem preenchidos.
2. **Erros `#DIV/0!`** em dias sem dados: mostrar "—".
3. **Taxa de 13,86% fixa** dentro da fórmula: vira configuração.
4. **Buraco entre 1,59 e 1,60** nas faixas de cor: usar limites contínuos (`>=`).
5. **Erro de digitação:** na linha 20/08 há 12 vendas com 10 cliques Shopee. Avisar (sem bloquear) quando vendas > cliques Shopee.
6. **Decisão com pouco dado:** só sugerir "Pausar" após um investimento mínimo (padrão R$ 30). Antes disso, mostrar "Coletando dados".

## 3. Decisão de arquitetura

### Recomendação: programa local em um único executável, com SQLite embutido

O usuário dá dois cliques em `GestorTrafego.exe`; o programa abre o navegador em `http://localhost:4173`. Os dados ficam em **um arquivo** (`dados/gestor.db`). Nada de Node, Python, Docker ou banco de dados para instalar.

| Opção | Instalação do usuário | Prós | Contras |
|---|---|---|---|
| **A. Executável local + SQLite (recomendada)** | Nenhuma (duplo clique) | Rápido, offline, fácil de testar pela CLI, dados em 1 arquivo | Só no computador onde está; aviso do Windows na 1ª execução; backup precisa de cuidado |
| B. Google Sheets + Apps Script | Nenhuma (abre um link) | Acessa de qualquer lugar, dados no Drive | Lento, interface limitada, deploy mais chato, difícil testar |
| C. Só HTML no navegador (IndexedDB) | Nenhuma | Simplíssimo | Limpar o navegador apaga tudo; sem backup confiável |

**Por que A:** é a melhor combinação de "instalar zero coisa" com velocidade e robustez, e é a mais fácil de você construir e testar pela CLI. O uso de "Google Drive" entra como **backup**, não como banco (ver seção 11).

### Stack

- **Servidor:** [Bun](https://bun.sh) + TypeScript. `Bun.serve` para HTTP e `bun:sqlite` para o banco. Zero dependências npm no servidor.
- **Empacotamento:** `bun build --compile` gera o executável único (Windows x64; opcional macOS).
- **Interface:** HTML + CSS + JavaScript puro (módulos ES), sem framework e sem etapa de build. Gráficos em SVG desenhado à mão (o protótipo já tem o código).
- **Fontes:** Figtree e Bricolage Grotesque em `.woff2` **dentro do projeto** (o sistema roda offline; nada de Google Fonts).
- **Testes:** `bun test`.

**Plano B (se a Fase 0 falhar):** Go com `modernc.org/sqlite` (SQLite em Go puro, sem CGO) e `go:embed` para os arquivos da interface. Mesma API e mesma interface; só o servidor muda.

### Regras de ouro

- **Um único lugar para cálculos:** `src/shared/calc.js`, sem dependências. É importado pelo servidor **e** servido ao navegador (para o cálculo ao vivo enquanto se digita). Nunca duplicar fórmula.
- Servidor escuta **somente** `127.0.0.1` (não expõe o sistema na rede).
- Dinheiro no banco em **centavos (inteiro)**. Somar sem arredondar e arredondar só na exibição (assim o total bate com a planilha).
- Datas como texto `AAAA-MM-DD`.

## 4. Estrutura de pastas

```
gestor-trafego/
├─ PLANO.md
├─ README.md                    # para você (desenvolvedor)
├─ package.json
├─ docs/
│  └─ prototipo-ui.html         # referência visual
├─ src/
│  ├─ server/
│  │  ├─ index.ts               # sobe o servidor, abre o navegador
│  │  ├─ db.ts                  # abre o SQLite, roda migrações, backup diário
│  │  ├─ migrations/001_init.sql
│  │  └─ routes/                # creatives, entries, dashboard, settings, importExport
│  ├─ shared/
│  │  └─ calc.js                # regras de cálculo (servidor + navegador)
│  └─ web/
│     ├─ index.html
│     ├─ css/                   # tokens.css, layout.css, components.css
│     ├─ js/                    # app.js, router.js, api.js
│     │  ├─ pages/              # dashboard, creatives, creative-detail, daily-entry, register, settings
│     │  └─ components/         # ruler, chart, filters, toast
│     └─ vendor/fonts/          # .woff2 locais
├─ scripts/
│  ├─ embed-assets.ts           # gera assets.ts com os arquivos da web embutidos
│  ├─ build.ts                  # compila o executável
│  └─ seed-demo.ts              # dados de exemplo para desenvolver
├─ tests/
│  ├─ calc.test.ts
│  └─ api.test.ts
└─ dist/                        # gerado: GestorTrafego.exe + LEIA-ME.txt
```

## 5. Modelo de dados (SQLite)

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;   -- NÃO usar WAL: o arquivo pode ficar numa pasta sincronizada (Drive)

CREATE TABLE creatives (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  product     TEXT,
  format      TEXT NOT NULL DEFAULT 'video'   CHECK (format IN ('video','image','carousel')),
  status      TEXT NOT NULL DEFAULT 'testing' CHECK (status IN ('testing','scaling','paused','discarded')),
  start_date  TEXT NOT NULL,                  -- AAAA-MM-DD
  url         TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  archived_at TEXT
);
CREATE UNIQUE INDEX ux_creatives_name ON creatives (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE daily_entries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id      INTEGER NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  date             TEXT    NOT NULL,          -- AAAA-MM-DD
  investment_cents INTEGER NOT NULL DEFAULT 0 CHECK (investment_cents >= 0),
  sales            INTEGER NOT NULL DEFAULT 0 CHECK (sales >= 0),
  revenue_cents    INTEGER,                   -- NULL = faturamento pendente (NÃO é zero)
  clicks_meta      INTEGER NOT NULL DEFAULT 0 CHECK (clicks_meta >= 0),
  clicks_shopee    INTEGER NOT NULL DEFAULT 0 CHECK (clicks_shopee >= 0),
  tax_rate         REAL    NOT NULL,          -- taxa vigente quando o dia foi lançado
  created_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (creative_id, date)
);
CREATE INDEX ix_entries_date ON daily_entries (date);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- padrões: tax_rate=0.1386, roas_good=1.2, roas_scale=1.6, min_spend_cents=3000
-- roas_breakeven é sempre 1.0 (ROAS 1 = lucro zero) e não é editável

CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
```

**Por que `tax_rate` em cada lançamento:** se o imposto mudar, os dias antigos não podem mudar de valor sozinhos. Em Configurações existe o botão opcional "Aplicar a todos os lançamentos antigos".

## 6. Regras de cálculo (`src/shared/calc.js`)

```
cost(e)        = e.investment × (1 + e.tax_rate)
profit(e)      = e.revenue == null ? null : e.revenue − cost(e)
cpcMeta(e)     = e.clicks_meta   > 0 ? e.investment / e.clicks_meta   : null
cpcShopee(e)   = e.clicks_shopee > 0 ? e.investment / e.clicks_shopee : null
roas(e)        = (e.revenue == null || cost(e) == 0) ? null : e.revenue / cost(e)

agg(entries):   // usado em totais, dashboard e biblioteca
  invest, cost, sales, clicks   = somas de TODOS os dias
  revenue, costClosed           = somas apenas dos dias com revenue != null
  roas   = costClosed > 0 ? revenue / costClosed : null
  profit = costClosed > 0 ? revenue − costClosed : null
  pendingDays = dias com revenue == null e investimento > 0
  costPerSale = sales > 0 ? cost / sales : null

decision(agg):
  sem dados                    → 'nodata'
  costClosed == 0              → 'pending'   (Aguardando faturamento)
  costClosed < min_spend       → 'collect'   (Coletando dados)
  roas >= roas_scale           → 'good'      (Escalar)
  roas >= roas_good            → 'ok'        (Manter)
  roas >= 1.0                  → 'warn'      (Observar)
  senão                        → 'bad'       (Pausar)
```

**Vetores de teste (saem da planilha real, devem passar em `calc.test.ts`):**

| Caso | Entrada | Esperado |
|---|---|---|
| Linha 01/08 | invest 4,18 · 10 cliques Meta · 19 Shopee | custo 4,759348 · CPC Meta 0,418 · CPC Shopee 0,22 |
| Linha 12/08 | invest 34,70 · 321 cliques Meta | custo 39,50942 · CPC Meta 0,1080996885 |
| Totais do mês | 13 linhas do arquivo enviado | invest 206,89 · custo 235,564954 · vendas 69 |
| ROAS total | faturamento 100 sobre custo 39,50942 | 2,53 |
| Pendente | faturamento `null` | lucro e ROAS `null`, fora do agregado |
| Divisão por zero | 0 cliques | CPC `null` (a tela mostra "—") |

## 7. API (JSON, somente localhost)

| Método e rota | Função |
|---|---|
| `GET /api/creatives` | lista com totais e decisão (aceita `q`, `status`, `product`) |
| `POST /api/creatives` | cadastra um criativo |
| `POST /api/creatives/bulk` | cadastra vários (`names[]` + campos comuns); recusa duplicados |
| `PUT /api/creatives/:id` | edita (inclui mudar status) |
| `DELETE /api/creatives/:id` | arquiva (não apaga os lançamentos) |
| `GET /api/creatives/:id/entries` | lançamentos do criativo (`from`, `to`) |
| `PUT /api/creatives/:id/entries/:date` | cria ou atualiza o dia (upsert) |
| `GET /api/entries?date=AAAA-MM-DD` | dia inteiro: um item por criativo ativo (tela de lançamento diário) |
| `POST /api/entries/bulk` | salva vários lançamentos numa só chamada (transação) |
| `GET /api/dashboard` | filtros: `from`, `to`, `creatives=1,2`, `status`, `product`, `decision` |
| `GET/PUT /api/settings` | imposto e faixas |
| `POST /api/backup` · `GET /api/export.xlsx` · `POST /api/import` | backup, exportar, importar planilha antiga |

**Resposta de `/api/dashboard`:** `period`, `previousPeriod` (mesmo tamanho, imediatamente antes), `totals`, `previousTotals`, `daily[]` (`date`, `cost`, `revenue|null`, `profit|null`, `pending`) e `creatives[]` (cada um com `agg` e `decision`).

**Validações (servidor):** investimento ≥ 0; números inteiros para vendas e cliques; nome único (sem diferenciar maiúsculas); `vendas > cliques Shopee` devolve um **aviso** (`warnings[]`) mas salva.

## 8. Telas

Referência exata: `docs/prototipo-ui.html`. Rotas por hash (`#/dashboard`, `#/criativos`, `#/lancamento`, `#/criativo/:id`, `#/cadastro`, `#/config`).

### Dashboard
- Filtros combináveis: **período** (Hoje, Ontem, 7/14/30 dias, Este mês, Mês passado, Todo o período, Personalizado), **criativo** (múltipla escolha com busca), **status**, **produto**, **decisão**.
- Resumo: Lucro (destaque), ROAS com a **régua de ROAS**, Investimento, Faturamento, Vendas, Custo por venda, Cliques, CPCs, cada um com variação contra o período anterior (▲▼ verde/vermelho; para custos, menor é melhor).
- Aviso quando há dias com faturamento pendente.
- Gráfico diário: linhas de custo e faturamento, barras de lucro/prejuízo, faixa hachurada nos dias pendentes, dica ao passar o mouse.
- Tabela "Decisão por criativo", ordenável (lucro, ROAS, custo, vendas), clique abre o criativo.

### Criativos
- **Biblioteca:** busca, filtro de status, ordenação, tabela com ROAS, lucro e ação sugerida.
- **Detalhe do criativo:** réplica da planilha. Colunas digitáveis: Investimento, Vendas, Faturamento, Cliques Meta, Cliques Shopee. Colunas cinza (calculadas): Custo c/ imposto, Lucro, CPC Meta, CPC Shopee, ROAS. Dias mais recentes no topo, linha de TOTAL fixa no rodapé, filtro por mês, botão "Adicionar dia", ícone de aviso quando vendas > cliques Shopee. Recalcula ao digitar.
- **Lançamento diário:** a tela mais importante do dia a dia. Um dia, todos os criativos ativos numa tabela. Enter desce para a próxima linha, contador "X de Y preenchidos", salvar em lote. Faturamento vazio = pendente.

### Cadastro
- Modo **um criativo** ou **vários de uma vez** (um nome por linha, com pré-visualização e duplicados em vermelho).
- Campos: nome, produto (sugere os já usados), formato, data de início, status, link e observações.
- Botão "Cadastrar e lançar dados" leva direto ao lançamento diário. Depois de cadastrar, mantém produto/formato/data para agilizar o próximo.

### Configurações
- Imposto (%), "Manter a partir de", "Escalar a partir de", investimento mínimo para decidir; validar que os limites crescem.
- Dados e backup: caminho do arquivo, fazer backup, exportar e importar planilha.

## 9. Design

- **Cor só significa decisão.** A interface é neutra; verde, azul, amarelo e vermelho aparecem apenas nas faixas de ROAS, lucro e prejuízo.
- **Régua de ROAS:** 4 blocos de mesma largura (vermelho, amarelo, azul, verde) com um marcador; a posição é interpolada dentro de cada bloco. É o elemento de identidade do produto.
- Tipografia: Bricolage Grotesque (títulos e números grandes) + Figtree (interface), números tabulares.
- Tema claro e escuro (segue o sistema, com botão). Responsivo, mas pensado para desktop.
- Valores em R$ no formato brasileiro; campos aceitam `4,18` e `4.18`.
- Tokens de cor e espaçamento em `tokens.css`, extraídos do `<style>` do protótipo.

## 10. Fases

### Fase 0 — Esqueleto e teste do executável (fazer primeiro)
- Criar o projeto, um servidor "olá" com `bun:sqlite`, uma página estática embutida no executável e abrir o navegador sozinho.
- Tratar porta ocupada (tenta a próxima) e segunda instância (só abre o navegador).
- Gerar o `.exe` e **testar em um Windows limpo, sem Bun nem Node instalados**.
- **Pronto quando:** duplo clique abre a página e cria `dados/gestor.db`. Se falhar (antivírus, embutir arquivos), ativar o Plano B (Go).
- Embutir a pasta `web/`: usar `scripts/embed-assets.ts` para gerar um módulo com os arquivos (mais simples e confiável do que depender de sistema de arquivos dentro do executável).

### Fase 1 — Núcleo: banco, cálculos e API
- Migração `001_init.sql`, `calc.js`, rotas de criativos, lançamentos e configurações.
- `seed-demo.ts` com dados de exemplo.
- **Pronto quando:** `bun test` passa com todos os vetores da seção 6 e a API responde via `curl`.

### Fase 2 — Interface base + Cadastro + Criativos
- Layout, tokens, tema, roteador, toast.
- Cadastro (um e vários), Biblioteca, Detalhe (planilha editável) e Lançamento diário.
- **Pronto quando:** dá para cadastrar 5 criativos e lançar o dia deles em menos de 2 minutos, e os totais do detalhe batem com `agg()`.

### Fase 3 — Dashboard
- Filtros, resumo com variação, gráfico, tabela de decisão, régua.
- Endpoint `/api/dashboard` com período anterior.
- **Pronto quando:** cada filtro muda os números corretamente e o dashboard fica igual ao protótipo.

### Fase 4 — Importar, exportar, backup, configurações
- **Importar a planilha antiga** (`.xlsx`, uma aba = um criativo; pedir o nome do criativo, pois na planilha ele é o texto "Nome Criativo"). Ignorar linhas sem investimento; tratar faturamento 0 como pendente (perguntar ao usuário).
- Exportar `.xlsx` e `.csv`.
- Backup diário ao abrir o sistema em `dados/backups/` (manter os 30 últimos) e botão "Fazer backup agora".
- **Pronto quando:** importar `Cópia_de_Agosto_2026.xlsx` resulta em invest 206,89 · custo 235,56 · 69 vendas.

### Fase 5 — Entrega ao usuário final
- `build.ts` gera `dist/GestorTrafego.exe` e `LEIA-ME.txt` (3 passos, sem termos técnicos: como abrir, o que fazer no aviso do Windows, onde ficam os dados).
- Ícone do aplicativo, nome da janela do navegador, mensagem amigável se a porta estiver ocupada.
- **Pronto quando:** uma pessoa não técnica consegue abrir e usar sozinha lendo só o `LEIA-ME.txt`.

## 11. Dados, backup e Google Drive

- Tudo fica em `dados/gestor.db` (mais `dados/backups/`).
- **Backup no Drive:** o usuário instala o Google Drive para computador e coloca a pasta do sistema dentro do Drive. Funciona porque o modo do SQLite é `DELETE` (sem arquivos `-wal`).
- **Aviso importante:** usar em **um computador por vez**, com o programa fechado ao trocar de máquina. Dois computadores abrindo o mesmo `.db` sincronizado podem corromper os dados.
- Se no futuro precisar acessar de vários dispositivos ao mesmo tempo, migrar o servidor para hospedagem (a API já isola o banco, então a interface não muda).

## 12. Riscos conhecidos

- **Windows SmartScreen** ("O Windows protegeu o computador"): normal para programas sem assinatura. O `LEIA-ME.txt` deve mostrar o caminho "Mais informações → Executar assim mesmo". Assinatura de código é opcional e paga.
- **Antivírus** podem marcar executáveis novos como suspeitos. Testar na Fase 0; se acontecer, o Plano B (Go) costuma ter menos problema.
- **Perda de dados:** por isso o backup diário automático é obrigatório, não opcional.
- **Fórmula duplicada:** qualquer cálculo fora de `calc.js` é bug; conferir em revisão.

## 13. Decisões em aberto (responder antes ou durante a Fase 1)

1. Windows, macOS ou os dois? (o plano assume Windows.)
2. Um só usuário ou mais de uma pessoa usando ao mesmo tempo? (se for mais de uma, a opção A precisa mudar para servidor hospedado.)
3. Faturamento pendente fica fora do ROAS (como no protótipo) ou você prefere tratar como zero até preencher?
4. Os nomes das ações ("Escalar", "Manter", "Observar", "Pausar") e o investimento mínimo de R$ 30 fazem sentido para o seu jeito de decidir?
5. Além de Meta e Shopee, haverá outros canais (TikTok, Google)? Hoje as colunas de cliques são fixas.

## 14. Ideias para depois (fora do v1)

- Puxar o investimento direto da API do Meta Ads, sem digitar.
- Miniatura/preview do criativo e tags de gancho/ângulo para comparar o que funciona.
- Alertas ("criativo com ROAS abaixo de 1,0 há 3 dias").
- Comparar dois criativos lado a lado.
