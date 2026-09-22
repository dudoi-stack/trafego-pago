# Pacote legacy Catalina (variante Node 18, duplo clique, offline)

MacBook Pro 2012 no macOS Catalina 10.15 não abre o executável atual
(erro de símbolo do sistema novo). Atualizar o sistema ou trocar de
máquina estão fora de questão.

Entregar uma variante legacy só para o Mac antigo, sem mudar nada no
padrão (Windows e Macs novos continuam no runtime atual) e sem tocar o
glossário do produto:

- Servidor idêntico (mesmas rotas, métodos, códigos, envelopes, mesma
  página, mesmos ativos embutidos, mesmo cálculo ao-vivo offline), só o
  runtime troca: Node 18.20.8 embarcado para darwin-x64, verificado por
  SHA-256 oficial (`ed255467…cacd76`), vendorado fora do controle de
  versão (`dist/legacy/runtime/`, ignorado pelo git).
- Persistência com `better-sqlite3@11.10.0` pinado (prebuild darwin-x64):
  o mesmo arquivo `gestor.db` abre nos dois runtimes sem migração de
  esquema; backup diário + backup-antes-de-migrar + retenção mantidos.
- Lançador de duplo clique (`GestorTrafego-legacy.command`) com janela
  visível (endereço + pasta de dados), abertura do navegador e
  encerramento limpo; segunda abertura só reabre o navegador (trava +
  sonda de saúde + próxima porta livre, como no padrão).
- Dados fora do pacote (`~/Library/Application Support/GestorTrafego/`):
  atualizar é trocar só a pasta, sem perder nada.
- Primeira abertura de sistema não assinado documentada (botão direito →
  Abrir; se preciso, `xattr -dr com.apple.quarantine` na pasta), sem
  admin e sem instalar nada.
- Verificação sem acesso ao Mac alvo: script de fumaça
  (`Fumaca.command` + `smoke`) imprime versão, saúde, caminhos, snapshot
  e cálculo para colar no suporte, mais checklist de aceite (abre →
  lança dia → fecha → reabre com dados).

Fora do escopo: mudar a tela ou o fluxo web, mudar regras de Sinal,
Escalando, Dia 1, ROAS ou Imposto, migrar esquema, mexer no executável
Windows ou nos pacotes de Macs novos, instalador, auto-update,
assinatura/notarização, outras linhas de Node ou outros sistemas.
Plano B (WASM puro com persistência manual) fica só documentado.

Linha Node 18 em fim de vida: aceitável porque o uso é local e offline;
o checksum congela a procedência.
