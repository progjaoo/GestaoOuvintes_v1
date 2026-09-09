# Webhooks Clerk

## Endpoint

A API local exposta pelo `api-ouvintes` possui a rota:

```text
POST /api/webhooks/clerk
```

A rota so e registrada quando `CLERK_WEBHOOK_ENABLED=true`. Quando desabilitada,
ela nao existe e responde `404`.

O endpoint recebe somente eventos Clerk de ciclo de vida:

- `user.created`;
- `user.updated`;
- `user.deleted`.

A assinatura e validada com `verifyWebhook` sobre o corpo HTTP original. O
payload bruto nunca e salvo no banco nem escrito em log.

## Variaveis da API

Adicionar somente no ambiente do backend, nunca no frontend:

```dotenv
CLERK_WEBHOOK_ENABLED=false
CLERK_WEBHOOK_SIGNING_SECRET=
CLERK_WEBHOOK_INSTANCE_KEY=development
CLERK_WEBHOOK_BODY_LIMIT_BYTES=131072
```

`CLERK_WEBHOOK_SIGNING_SECRET` e o segredo `whsec_...` fornecido pelo endpoint
criado no Clerk. O valor nao deve ser commitado, colocado no banco ou enviado
para o navegador.

`CLERK_WEBHOOK_INSTANCE_KEY` identifica a instancia Clerk usada pelo ambiente.
Use `development` localmente e um valor separado em cada ambiente de producao.

## Configuracao no Clerk

1. Acessar o ambiente correto no Clerk Dashboard.
2. Abrir Webhooks e criar um endpoint.
3. Usar a URL publica do backend, nunca a URL do site institucional:
   `https://<api-publica>/api/webhooks/clerk`.
4. Selecionar `user.created`, `user.updated` e `user.deleted`.
5. Copiar o Signing Secret do endpoint para `CLERK_WEBHOOK_SIGNING_SECRET`.
6. Habilitar `CLERK_WEBHOOK_ENABLED=true` apenas depois de configurar o segredo.
7. Enviar um evento de teste e verificar a resposta sem expor PII nos logs.

Para desenvolvimento local, a URL precisa ser HTTPS e publicamente alcancavel.
Use um tunnel temporario aprovado pela equipe. Nao abra a porta do PostgreSQL e
nao aponte o Clerk para o frontend.

## Comportamento de dados

- O PostgreSQL continua sendo a fonte oficial dos dados do ouvinte.
- O evento global e deduplicado por `instance_key + event_id`.
- O mesmo evento com o mesmo hash e replay seguro.
- O mesmo `event_id` com outro hash e rejeitado como incidente de integridade.
- Eventos antigos nao sobrescrevem estado mais recente.
- Somente identidades locais ja vinculadas ao `clerk_user_id` sao alteradas.
- Metadata do Clerk nunca resolve tenant.
- Contatos so sao sincronizados quando primarios e verificados.
- Divergencias de contato geram atividade de conflito; nao ha merge automatico.
- `user.deleted` desativa a identidade, marca o perfil como `deleted`, revoga
  dispositivos e handoffs e remove opt-ins de comunicacao, preservando historico.

## Validacao local

O banco de integracao deve ser separado do banco de desenvolvimento:

```bash
DATABASE_URL="<url-do-banco-com-_test>" DATABASE_SSL=false npm run db:migrate
RUN_INTEGRATION_TESTS=true DATABASE_URL="<url-do-banco-com-_test>" DATABASE_SSL=false npm test -- --run tests/integration/clerk-webhook.test.ts
```

Validacoes executadas neste plano:

```bash
npm run typecheck
npm test -- --run
npm run build
```

O smoke test com um evento real do Clerk permanece pendente ate que o Signing
Secret seja configurado no ambiente local e um endpoint HTTPS temporario seja
criado no Clerk Dashboard.

## Rotacao e incidente

Ao suspeitar de vazamento:

1. Rotacionar o Signing Secret no endpoint Clerk.
2. Atualizar apenas o segredo do backend.
3. Reiniciar/recriar a API.
4. Confirmar que assinaturas antigas sao rejeitadas.
5. Auditar eventos com status `failed` ou IDs reutilizados.
6. Nao apagar os registros de auditoria durante a investigacao.
