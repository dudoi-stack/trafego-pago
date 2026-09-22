/** LEIA-ME legacy (T5 — Mac antigo, Catalina, duplo clique, sem instalar).
 * Fonte única: `scripts/build-legacy.ts` gera `dist/legacy/LEIA-ME-LEGACY.txt`
 * a partir daqui, e o teste `tests/legacy-package.test.ts` trava o mínimo.
 * Primeira abertura de sistema não assinado + quarentena, sem admin. */
export function buildLeiaMeLegacy(version: string): string {
  return [
    `Gestor de Tráfego Pago v${version} (legacy Catalina) — duplo clique, 100% offline`,
    ``,
    `Sem instalar nada: sem Terminal digitado, sem admin, sem internet. Funciona offline.`,
    `Para o MacBook Pro 2012 no macOS Catalina 10.15 (Intel).`,
    ``,
    `== Como abrir (duplo clique) ==`,
    `1. Dê duplo clique em GestorTrafego-legacy.command.`,
    `2. Uma janela abre mostrando o endereço (http://127.0.0.1:4173 ou a`,
    `   próxima livre) e a pasta de dados. O navegador abre sozinho no painel.`,
    `   Se o programa já estiver aberto, clicar de novo só reabre o navegador`,
    `   (não duplica o servidor).`,
    `3. Para parar, feche a janela (Ctrl+C).`,
    ``,
    `== Primeira abertura (sistema não assinado, sem precisar de admin) ==`,
    `Na primeira vez o macOS (Gatekeeper) pode bloquear por não ter assinatura:`,
    `clique com o botão direito no arquivo GestorTrafego-legacy.command`,
    `e escolha "Abrir" (e confirme em "Abrir" de novo).`,
    `Se o macOS disser que o arquivo é de desenvolvedor não identificado,`,
    `remova só a quarentena do pacote (sem admin, sem instalar nada):`,
    `xattr -dr com.apple.quarantine /caminho/para/a-pasta-do-pacote`,
    `Depois dê duplo clique de novo.`,
    ``,
    `Onde ficam os dados (fora do pacote — trocar a pasta não apaga nada):`,
    `- Mac antigo: ~/Library/Application Support/GestorTrafego/gestor.db`,
    `- Backups: pasta "backups" ao lado do banco (30 últimos, um por dia).`,
    ``,
    `Para atualizar sem medo: feche o programa, troque SÓ a pasta do pacote`,
    `pela nova e abra de novo. Ao abrir, o app faz backup-antes-de-migrar`,
    `automaticamente e migra o banco sozinho — nada se perde.`,
    `Para trocar de computador, feche o programa antes de copiar a pasta.`,
    ``,
  ].join("\n");
}

/** Checklist de aceite do pacote legacy (abre → lança dia → fecha → reabre).
 * Fonte única: `scripts/build-legacy.ts` gera `dist/legacy/CHECKLIST-LEGACY.txt`. */
export function buildChecklistLegacy(): string {
  return [
    `Aceite do pacote legacy (Catalina) — abre, lança dia, fecha, reabre com dados`,
    ``,
    `1. Abre: duplo clique em GestorTrafego-legacy.command abre a janela com`,
    `   o endereço + a pasta de dados, e o navegador abre sozinho no painel.`,
    `2. Lança dia: cadastre um Criativo e lance os números do dia`,
    `   (investimento, vendas, faturamento, cliques). O Sinal e o ROAS aparecem.`,
    `3. Fecha: feche a janela (Ctrl+C). O servidor encerra limpo sem erro.`,
    `4. Reabre com dados: duplo clique de novo — o Criativo e o Lançamento`,
    `   continuam lá. Trocar só a pasta do pacote nunca apaga os dados.`,
    `5. (Opcional) Rode a fumaça e cole o resultado no suporte:`,
    `   com o app aberto, duplo clique em Fumaca.command lê os caminhos reais;`,
    `   com o app fechado, roda um ciclo isolado que prova que o pacote funciona.`,
    ``,
  ].join("\n");
}
/** LEIA-ME de 3 passos (T6 — entrega Win+Mac offline sem medo de atualizar).
 * Fonte única: `scripts/build.ts` gera `dist/LEIA-ME.txt` a partir daqui,
 * e o teste `tests/t6.test.ts` trava o conteúdo mínimo. */
export function buildLeiaMe(version: string): string {
  return [
    `Gestor de Tráfego Pago v${version} — como abrir (3 passos, 100% offline)`,
    ``,
    `Sem instalar nada: sem Node, sem banco, sem internet. Funciona offline.`,
    `Valores em R$ no formato brasileiro (aceita 4,18 e 4.18).`,
    ``,
    `== Windows (GestorTrafego.exe) ==`,
    `1. Dê dois cliques em GestorTrafego.exe.`,
    `2. Se o Windows mostrar "O Windows protegeu o computador" (programa sem`,
    `   assinatura no v1 — SmartScreen), clique em "Mais informações" e depois`,
    `   em "Executar assim mesmo".`,
    `3. O navegador abre sozinho no painel. Se o programa já estiver aberto,`,
    `   clicar de novo só abre o navegador (não duplica o servidor).`,
    ``,
    `== Mac (GestorTrafego-macos-arm64 ou -x64) ==`,
    `1. Dê dois cliques no executável do seu Mac (arm64 = Apple Silicon, x64 = Intel).`,
    `2. Se o macOS bloquear (Gatekeeper, programa sem assinatura no v1):`,
    `   clique com o botão direito no arquivo e escolha "Abrir" (e confirme`,
    `   em "Abrir" de novo). Se precisar: chmod +x no Terminal.`,
    `3. O navegador abre sozinho no painel. Se o programa já estiver aberto,`,
    `   clicar de novo só abre o navegador (não duplica o servidor).`,
    ``,
    `Onde ficam os dados (fora do executável — trocar o exe não apaga nada):`,
    `- Windows: %APPDATA%\\GestorTrafego\\gestor.db`,
    `- Mac: ~/Library/Application Support/GestorTrafego/gestor.db`,
    `- Backups: pasta "backups" ao lado do banco (30 últimos, um por dia).`,
    ``,
    `Para atualizar sem medo: feche o programa, troque SÓ o executável pelo`,
    `novo e abra de novo. Ao abrir, o app faz backup-antes-de-migrar`,
    `automaticamente e migra o banco sozinho — nada se perde.`,
    `Para trocar de computador, feche o programa antes de copiar a pasta.`,
    ``,
  ].join("\n");
}
