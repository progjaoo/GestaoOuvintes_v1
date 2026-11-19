
## 19/11/2026 - Retirada manual do ar

- Enquetes > Gestao > Acoes > Retirar do ar, com poll.close, confirmacao e preservacao de votos, mensagens e cadastros. Link direto e novas submissoes bloqueados no backend.
- Automacao continua para proximas enquetes, mas respeita closed/canceled/archived mesmo apos edicao externa. Nenhuma escrita/exclusao no Google. Retirada definitiva por enquete, nao pausa global reversivel.
- Repasse das participacoes aos locutores, operacao completa dos cadastros, selecao e sorteios permanecem pendentes de especificacao/implementacao. Nao anunciar esses fluxos como prontos.
- CTA da home atualiza no refetch de 15s, mais cache de ate 5s; backend bloqueia submissoes ao encerrar.
