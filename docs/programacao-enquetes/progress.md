
## 19/11/2026 - Retirada manual do ar

- Enquetes > Gestao > Acoes > Retirar do ar, com poll.close, confirmacao e preservacao de votos, mensagens e cadastros. Link direto e novas submissoes bloqueados no backend.
- Automacao continua para proximas enquetes, mas respeita closed/canceled/archived mesmo apos edicao externa. Nenhuma escrita/exclusao no Google. Retirada definitiva por enquete, nao pausa global reversivel.
- Repasse das participacoes aos locutores, operacao completa dos cadastros, selecao e sorteios permanecem pendentes de especificacao/implementacao. Nao anunciar esses fluxos como prontos.
- CTA da home atualiza no refetch de 15s, mais cache de ate 5s; backend bloqueia submissoes ao encerrar.

## 19/11/2026 - Cor da borda da capa no card No Ar (local)

- Diagnosticado mapa de arquivos Preview no Institucional sem metadado equivalente na API de Production. Correcao na branch codex/program-image-edge-color-local: migracao 0030, extracao Sharp no upload, cor por asset e campo opcional imageEdgeColor no snapshot.
- Backfill idempotente com dry-run e auditoria; sete capas locais atualizadas, repeticao zero. Sem regravar R2 ou alterar enquetes/usuarios. Backup PostgreSQL local preservado.
- Typecheck/build API e 272 testes unitarios aprovados. Imagem Docker reproduzivel preparada; atualizacao local aplicada, sem deploy/migracao em Production.
- Procedimento e limites: program-image-colors.md. Publicacao da grade pelo painel local ainda exige sessao administrativa valida.

### Conferencia da cor publicada no institucional local

- Titular realizou login no BrowserOS e a grade foi publicada pelo fluxo autorizado: revisao 53 no namespace preview/radio-88. API publica retornou 11 programas e 37 horarios; seis capas ativas incluem imageEdgeColor.
- Home Docker conferida com Temperatura Gospel: borda #FFB900, fundo derivado, capa carregada e altura 370px. Logo da radio preservada no mini player. Bom Dia 88 consta com #E73C24. Nenhuma enquete ou participacao foi alterada; endpoints locais de enquete ativa desses programas retornaram poll:null.
- Publicacao/conferencia local concluida, sem deploy ou migracao em Production.

## 19/11/2026 - Rollout autorizado das cores em Production

- Titular autorizou publicar os ajustes finais. Backup Neon backup-before-program-image-colors-20261119 (br-winter-flower-axotspub), sem compute adicional.
- Migracao 0030 aplicada em main pelo runner db:migrate. Backfill operacional leu apenas as seis capas publicas vinculadas a Production, com a mesma extracao Sharp validada localmente, limite de tamanho e sem regravar R2. Seis metadados atualizados em transacao e auditados; nenhum ID/arquivo de Preview copiado.
- Typecheck/build API e 272 testes unitarios aprovados. API e publicacao do snapshot de Production pendentes de conferencia apos deploy. Enquetes e dados de ouvintes nao foram modificados pelo backfill.
