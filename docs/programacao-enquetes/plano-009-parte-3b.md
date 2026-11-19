# Plano 009 — Parte 3b: gestão visual da sincronização

**Estado:** implementado localmente no painel; integração Google real ainda não conectada.

## O que foi entregue

- Nova página `CalendarIntegrationPage` em `/enquetes/integracao`, dentro do módulo de Enquetes; não cria um item extra na sidebar.
- Atalho **Agenda Google** na lista de enquetes, visível apenas para quem tem alguma permissão da integração.
- Exibição do status OAuth e início do consentimento com popup; a tela consulta o status enquanto o usuário conclui a autorização.
- Configuração da fonte `88 - ENQUETE` usando o ID allowlisted no backend. Ao criar a fonte, o programa padrão é **Bom Dia 88**.
- Configuração explícita de programas permitidos. O programa padrão permanece permitido; a edição só fica disponível com a fonte desativada.
- Ativação/desativação da fonte e sincronização manual com resumo de eventos consultados, alterados, pendentes, cancelados e ignorados por estarem no passado.
- Lista privada dos eventos importados, com pergunta, contexto, alternativas, período e motivo de pendência para conferência.
- Nenhuma ação de criar enquete, aprovar, publicar, editar ou excluir evento foi adicionada nesta etapa.
- A interface não recebe tokens OAuth nem cursores do Google. As credenciais continuam no backend.

## Permissões

- `calendar_integration.read`: lista fontes e eventos importados.
- `calendar_integration.manage`: consulta conexão, inicia OAuth e configura programas/fonte.
- `calendar_integration.sync`: solicita sincronização manual.
- As permissões permanecem independentes; a tela não concede acessos nem altera papéis.

## Garantias

- Integração somente leitura: nenhuma chamada de criação, edição ou exclusão é feita à API do Google Calendar.
- Sincronização salva somente staging privado. Não cria enquete administrativa e não altera o institucional.
- `Bom Dia 88` é selecionado como padrão quando a lista de programas contém esse nome. Não há fallback silencioso para outro programa.
- A edição de programa padrão/lista permitida usa controle de versão e exige desativar a fonte antes de salvar.
- O fluxo de cadastro manual de enquetes permanece disponível e independente.

## Arquivos principais

- `painel-adm/src/pages/CalendarIntegrationPage.tsx`
- `painel-adm/src/pages/CalendarIntegrationPage.test.tsx`
- `painel-adm/src/pages/PollsPage.tsx`
- `painel-adm/src/App.tsx`
- `painel-adm/src/services/api.ts`
- `painel-adm/src/types/calendar-integration.ts`
- API da Parte 3a: `api-ouvintes/src/routes/admin-calendar-oauth.ts` e serviços `google-calendar-*` / `calendar-poll-*`.

## Validação local

- Painel: 26 arquivos de teste, 142 testes aprovados.
- Painel: ESLint aprovado e `npm run build` aprovado. Permanece o aviso de bundle principal acima de 500 KB.
- API: `sh api-ouvintes/scripts/test-calendar-staging.sh` executado com rede interna e PostgreSQL descartável; migrações 0001–0026 executadas duas vezes e 64 testes aprovados, além de typecheck e build.
- O script descartável remove apenas os recursos Docker temporários criados por ele.
- Os containers persistentes `radio88-feed-*` não foram reiniciados ou alterados: o API ativo está vinculado a outro checkout e não declara `GOOGLE_CALENDAR_ENABLED`.

## Ainda não comprovado

- Consentimento OAuth real, conta `producao88fm@gmail.com`, identificação real da agenda `88 - ENQUETE` e leitura de eventos não foram executados nesta sessão.
- O BrowserOS Neo não estava disponível como ferramenta nesta sessão. Não foi usado outro navegador nem foram inventadas credenciais.
- A aplicação da tela no stack persistente requer atualizar o stack a partir deste worktree e confirmar o ambiente Docker/API correto. Nenhuma migração foi aplicada ao banco persistente.

## Próxima etapa

Com OAuth e a agenda configurados, validar uma sincronização real que apenas leia e grave no staging. Depois, implementar a conferência/transformação de um evento aprovado em enquete do Gestão, com vínculo idempotente ao evento de origem. A criação/publicação automática deve permanecer desativada até esse fluxo ser validado; nenhum evento ou conteúdo existente da agenda será apagado.
