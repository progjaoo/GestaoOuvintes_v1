# PRD 001 - Cadastro de Ouvintes para o Lançamento do Institucional

Status: Planejamento para aprovação  
Data de referência: 16/07/2026  
Lançamento previsto: 01/08/2026  
Tipo: WEB / API / BANCO / PAINEL ADMIN / INFRAESTRUTURA  
Stack recomendada: React 18, TypeScript, Node.js, Express/Fastify, PostgreSQL, Docker, JWT, Vitest/Jest

## 1. Agentes responsáveis

Este planejamento combina os seguintes agentes definidos em `agents/README.md`:

1. **Product Manager**: delimitação do MVP, regras de negócio, cronograma e critérios de aceite.
2. **Tech Lead / Arquiteto**: separação do novo domínio de cadastros e integração entre aplicações.
3. **Database Engineer**: modelagem PostgreSQL, índices, integridade, backup e evolução futura.
4. **Backend API Engineer**: API pública de cadastro, endpoints administrativos e exportações.
5. **Institutional Frontend Engineer**: modal de cadastro no site institucional.
6. **Admin Frontend Engineer**: painel React separado para consulta, filtros, exportação e login administrativo.
7. **Mobile First / Mobile Engineer**: experiência do modal entre 320px e 430px.
8. **Security Engineer**: LGPD, proteção dos dados, rate limiting, autenticação e auditoria.
9. **DevOps / Release Engineer**: PostgreSQL, API, variáveis, HTTPS, monitoramento e backups.
10. **QA Engineer**: testes de cadastro, segurança, responsividade, exportação e recuperação.
11. **Documentation Engineer**: documentação operacional e atualização do ecossistema.

## 2. Contexto

O site `radio-88-fm-institucional` será lançado em 1º de agosto e deve iniciar uma base de ouvintes da Rádio 88 FM.

Ao acessar o institucional, o visitante receberá um convite opcional para cadastro. O cadastro inicial terá:

- Nome: obrigatório.
- Bairro: obrigatório.
- Cidade: obrigatória.
- Telefone: opcional.

Esta primeira entrega precisa ficar pronta em aproximadamente 15 dias, mas não deve criar um modelo descartável. A solução deve permitir que, no futuro, os mesmos conceitos sejam usados pelo aplicativo, pelo institucional, por campanhas e por sorteios.

## 3. Decisão recomendada

### 3.1 Recomendação principal

Usar uma arquitetura híbrida:

- **PostgreSQL como fonte oficial dos dados**.
- **API Node.js simples e independente para o domínio de cadastros**.
- **Modal no institucional consumindo a API pública**.
- **Painel administrativo React separado, com login/senha e token JWT próprio**.
- **Exportação em XLSX e CSV gerada pela API**.
- **Google Sheets opcional como espelho operacional**, nunca como fonte única.

### 3.2 Por que não usar somente uma planilha

Uma planilha conectada diretamente ao site seria mais rápida apenas no primeiro momento, mas traria problemas:

- Credencial ou integração externa mais difícil de proteger.
- Ausência de validação centralizada.
- Risco maior de duplicidade e alterações manuais.
- Dificuldade de controlar acesso aos dados pessoais.
- Ausência de auditoria confiável de exportações e mudanças.
- Dependência da API e dos limites da plataforma de planilhas.
- Migração posterior mais trabalhosa.

O banco deve armazenar os registros. A planilha pode ser gerada sob demanda ou alimentada pela API como uma integração secundária.

### 3.3 Matriz de decisão

| Alternativa | Prazo | Segurança | Evolução | Operação | Decisão |
| --- | --- | --- | --- | --- | --- |
| Google Sheets como banco | Rápido | Baixa/média | Baixa | Simples no início | Não recomendado |
| PostgreSQL + API + exportação | Viável em 15 dias | Alta | Alta | Moderada | Recomendado |
| PostgreSQL + API + espelho em Sheets | Viável após o núcleo | Alta | Alta | Fácil para a chefia | Melhor evolução |
| Adicionar tudo diretamente ao `PortalGtf`/MySQL | Rápido | Média/alta | Acopla notícias e ouvintes | Uma API | Não recomendado para este domínio |
| Node.js + PostgreSQL + painel React separado | Viável em 15 dias | Alta | Alta | Separado do CMS atual | Recomendado para esta etapa |

## 4. Objetivos

1. Capturar cadastros voluntários de ouvintes no lançamento.
2. Não impedir o acesso ao site caso o visitante não queira se cadastrar.
3. Armazenar os dados em banco confiável e com backup.
4. Permitir que usuários autorizados consultem e filtrem os registros.
5. Permitir exportação em Excel e CSV.
6. Preparar campanhas futuras, incluindo sorteios, sem remodelar toda a aplicação.
7. Manter separação entre o domínio editorial do `PortalGtf` e o domínio de relacionamento com ouvintes.
8. Atender requisitos mínimos de privacidade, segurança e rastreabilidade.

## 5. Escopo do MVP de lançamento

### 5.1 Dentro do escopo

- Modal de cadastro no `radio-88-fm-institucional`.
- Botão claro de fechar e ação "Agora não".
- Formulário com nome, bairro, cidade e telefone.
- Aviso de privacidade resumido e link para política completa.
- API pública para receber cadastros.
- PostgreSQL dedicado.
- Validação no frontend e, obrigatoriamente, na API.
- Proteção contra abuso e envios repetidos.
- Campanha configurável para o lançamento.
- Painel administrativo React separado, protegido por login e senha.
- Listagem paginada.
- Busca e filtros básicos.
- Exportação XLSX e CSV.
- Log de exportações administrativas.
- Backup e procedimento de restauração.
- Métricas técnicas e eventos GA4 sem dados pessoais.

### 5.2 Fora do escopo do lançamento

- Conta completa do ouvinte com login e senha.
- Integração com o aplicativo.
- CRM completo.
- Envio automatizado de WhatsApp.
- Disparo de SMS, e-mail ou push.
- Motor automatizado de sorteio.
- Programa de fidelidade/pontos.
- Segmentação avançada.
- Sincronização bidirecional com Google Sheets.

Esses itens ficam previstos para fases posteriores.

## 6. Arquitetura proposta

```text
radio-88-fm-institucional
        |
        | POST público /api/public/listener-registrations
        v
radio88-cadastros-api (Node.js)
        |
        v
PostgreSQL - radio88_cadastros

radio88-cadastros-admin (React)
        |
        | login + JWT administrativo simples
        v
radio88-cadastros-api (Node.js)
        |
        +--> consulta paginada
        +--> busca e filtros básicos
        +--> exportação XLSX/CSV
        +--> auditoria de exportações

Opcional após o lançamento:
radio88-cadastros-api --> Google Sheets corporativo
```

### 6.1 Separação do backend

Criar um serviço independente em Node.js:

```text
radio88-cadastros/
├── api/
│   ├── src/
│   ├── tests/
│   ├── package.json
│   └── Dockerfile
├── admin/
│   ├── src/
│   ├── package.json
│   └── dist/
├── database/
│   ├── migrations/
│   └── seeds/
└── docs/
```

Motivos:

- O `PortalGtf` continua responsável por notícias, mídias, CMS editorial e institucional atual.
- Uma indisponibilidade no cadastro não afeta publicação ou leitura de notícias.
- O PostgreSQL não precisa ser introduzido no modelo MySQL existente do `PortalGtf`.
- O serviço poderá evoluir para ouvintes, campanhas, aplicativo e sorteios.
- O backup e a retenção dos dados pessoais ficam isolados.
- O painel administrativo pode ser publicado como `dist` estático em uma hospedagem do grupo GTF, sem depender do `cms-feitoamao`.

### 6.2 Autenticação administrativa

Para o MVP, o serviço de cadastros terá autenticação administrativa própria:

- Tela de login no painel React.
- Usuário e senha administrativos cadastrados no banco ou via seed inicial.
- Senha armazenada com hash forte: `bcrypt` ou `argon2`.
- API emite token JWT curto para acesso ao painel.
- Refresh token pode ficar fora do MVP; se necessário, usar sessão curta e novo login.
- Nenhum endpoint administrativo deve aceitar acesso anônimo.

Tabela administrativa mínima sugerida:

```text
admin_user
```

Campos:

- `id` UUID.
- `name`.
- `email` ou `username`.
- `password_hash`.
- `role`: `admin` inicialmente.
- `active`.
- `created_at`.
- `updated_at`.
- `last_login_at`.

Permissões propostas:

- `ouvintes.visualizar`
- `ouvintes.exportar`
- `ouvintes.gerenciar_campanhas`
- `ouvintes.excluir`

Para o MVP, a função `admin` pode liberar todas as ações do painel. A autorização granular deve continuar prevista para uma fase seguinte.

Nenhum endpoint de listagem ou exportação pode ser público.

## 7. Modelo de negócio expansível

### 7.1 Conceito de campanha

O cadastro deve pertencer a uma campanha, mesmo que inicialmente exista apenas uma:

```text
slug: lancamento-institucional-2026
nome: Lançamento do Site Institucional - 1º de Agosto
inicio: data/hora configurável
fim: data/hora configurável
status: draft | active | paused | closed
```

Isso permite criar futuramente:

- Cadastro geral de ouvintes.
- Campanha de aniversário.
- Sorteio específico.
- Cadastro vindo do aplicativo.
- Cadastro vindo de um banner.
- Cadastro em eventos presenciais.

### 7.2 Cadastro não é automaticamente participação em sorteio

O cadastro de ouvinte e a participação em sorteio devem ser conceitos separados.

Quando houver sorteio:

- Criar campanha específica.
- Publicar regulamento.
- Definir período e critérios de elegibilidade.
- Registrar aceite do regulamento separadamente.
- Não reutilizar silenciosamente um cadastro anterior como participação.
- Não obrigar consentimento de marketing para participar, salvo validação jurídica da regra aplicável.

### 7.3 Identidade futura do ouvinte

Como o telefone é opcional e ainda não existe e-mail ou conta do aplicativo, o MVP não tem um identificador confiável para consolidar uma pessoa única.

Portanto:

- O MVP armazena **submissões de cadastro**.
- Não deve bloquear registros apenas porque nome, bairro e cidade coincidem.
- Se houver telefone, ele pode ajudar na deduplicação administrativa.
- A fase de cadastro unificado deverá criar `listener_profile` e `listener_identity` quando for definido um identificador estável: telefone verificado, e-mail verificado ou conta do aplicativo.

Essa decisão evita deduplicações incorretas entre pessoas com nomes semelhantes.

## 8. Modelo preliminar do PostgreSQL

### 8.1 Tabela `campaign`

| Campo | Tipo sugerido | Regra |
| --- | --- | --- |
| `id` | UUID | PK |
| `slug` | VARCHAR(100) | Único e obrigatório |
| `name` | VARCHAR(180) | Obrigatório |
| `status` | VARCHAR(20) | `draft`, `active`, `paused`, `closed` |
| `starts_at` | TIMESTAMPTZ | Obrigatório |
| `ends_at` | TIMESTAMPTZ | Opcional |
| `privacy_notice_version` | VARCHAR(30) | Obrigatório |
| `terms_url` | TEXT | Opcional |
| `created_at` | TIMESTAMPTZ | Default UTC |
| `updated_at` | TIMESTAMPTZ | Default UTC |

### 8.2 Tabela `listener_registration`

| Campo | Tipo sugerido | Regra |
| --- | --- | --- |
| `id` | UUID | PK |
| `campaign_id` | UUID | FK obrigatória |
| `name` | VARCHAR(160) | Obrigatório |
| `neighborhood` | VARCHAR(120) | Obrigatório |
| `city` | VARCHAR(120) | Obrigatório |
| `phone` | VARCHAR(20) | Opcional, normalizado |
| `source` | VARCHAR(50) | Ex.: `institutional_web` |
| `submission_token` | UUID | Idempotência do envio |
| `privacy_notice_version` | VARCHAR(30) | Versão aceita/visualizada |
| `privacy_acknowledged_at` | TIMESTAMPTZ | Obrigatório |
| `marketing_opt_in` | BOOLEAN | Default `false` |
| `marketing_opt_in_at` | TIMESTAMPTZ | Opcional |
| `utm_source` | VARCHAR(120) | Opcional |
| `utm_medium` | VARCHAR(120) | Opcional |
| `utm_campaign` | VARCHAR(120) | Opcional |
| `utm_content` | VARCHAR(120) | Opcional |
| `ip_hash` | VARCHAR(128) | Opcional, nunca IP bruto sem necessidade |
| `user_agent_summary` | VARCHAR(255) | Opcional e minimizado |
| `created_at` | TIMESTAMPTZ | Default UTC |
| `deleted_at` | TIMESTAMPTZ | Exclusão lógica controlada |

### 8.3 Tabela `registration_export_audit`

| Campo | Tipo sugerido | Regra |
| --- | --- | --- |
| `id` | UUID | PK |
| `admin_user_id` | UUID | Identificador do usuário do painel administrativo |
| `campaign_id` | UUID | Campanha exportada |
| `format` | VARCHAR(10) | `xlsx` ou `csv` |
| `filters_json` | JSONB | Filtros usados |
| `row_count` | INTEGER | Quantidade exportada |
| `created_at` | TIMESTAMPTZ | Data/hora da exportação |

### 8.4 Índices iniciais

- Índice em `campaign.slug`.
- Índice em `listener_registration.campaign_id`.
- Índice composto em `campaign_id, created_at DESC`.
- Índice em `city`.
- Índice em `neighborhood`.
- Índice parcial em `phone` quando não for nulo.
- Restrição única em `campaign_id, submission_token`.

### 8.5 Regras de normalização

- Remover espaços duplicados.
- Aplicar limites de tamanho.
- Preservar nome para exibição, mas criar comparação case-insensitive nas buscas.
- Normalizar telefone para dígitos com DDI/DDD quando informado.
- Não exigir telefone.
- Não usar telefone opcional como chave primária ou única.
- Salvar datas em UTC e converter para `America/Sao_Paulo` na apresentação.

O SQL definitivo deve ser criado na fase de implementação, com script de criação, validação e rollback seguro.

## 9. Contrato da API

API recomendada para o MVP:

- Node.js com TypeScript.
- Express ou Fastify.
- PostgreSQL com `pg`, Prisma ou Drizzle.
- Validação com Zod.
- JWT com `jsonwebtoken` ou `jose`.
- Hash de senha com `bcrypt` ou `argon2`.
- Exportação XLSX com `exceljs`.
- Exportação CSV com biblioteca que permita escape seguro.

### 9.1 Endpoint público de configuração

```http
GET /api/public/campaigns/lancamento-institucional-2026
```

Resposta resumida:

```json
{
  "slug": "lancamento-institucional-2026",
  "active": true,
  "title": "Faça parte da história da Rádio 88 FM",
  "description": "Cadastre-se para receber novidades da rádio.",
  "privacyNoticeVersion": "2026-08-01",
  "privacyNoticeUrl": "/privacidade"
}
```

Esse endpoint permite ativar, pausar ou encerrar o modal sem novo deploy do frontend.

### 9.2 Endpoint público de cadastro

```http
POST /api/public/listener-registrations
```

Request:

```json
{
  "campaignSlug": "lancamento-institucional-2026",
  "name": "Nome do ouvinte",
  "neighborhood": "Bairro",
  "city": "Cidade",
  "phone": "24999999999",
  "submissionToken": "uuid-gerado-no-cliente",
  "privacyNoticeVersion": "2026-08-01",
  "marketingOptIn": false,
  "source": "institutional_web",
  "utm": {
    "source": null,
    "medium": null,
    "campaign": null,
    "content": null
  }
}
```

Respostas:

- `201 Created`: cadastro realizado.
- `200 OK`: mesma submissão recebida novamente, sem duplicar.
- `400 Bad Request`: campos inválidos.
- `409 Conflict`: campanha fechada ou versão incompatível.
- `429 Too Many Requests`: limite de tentativas excedido.
- `500`: erro interno sem expor stack trace.

### 9.3 Endpoints administrativos

```http
POST /api/admin/auth/login
GET /api/admin/auth/me
POST /api/admin/auth/logout
GET /api/admin/listener-registrations
GET /api/admin/listener-registrations/{id}
GET /api/admin/listener-registrations/export?format=xlsx
GET /api/admin/listener-registrations/export?format=csv
GET /api/admin/campaigns
POST /api/admin/campaigns
PUT /api/admin/campaigns/{id}
```

Filtros mínimos:

- Campanha.
- Data inicial/final.
- Cidade.
- Bairro.
- Nome.
- Com telefone/sem telefone.

Listagem obrigatoriamente paginada.

### 9.4 Login administrativo

```http
POST /api/admin/auth/login
```

Request:

```json
{
  "username": "admin",
  "password": "senha"
}
```

Resposta:

```json
{
  "accessToken": "jwt",
  "expiresIn": 7200,
  "user": {
    "id": "uuid",
    "name": "Administrador",
    "role": "admin"
  }
}
```

Regras:

- Aplicar rate limiting no login.
- Não informar se usuário ou senha está errado separadamente.
- Registrar `last_login_at` em caso de sucesso.
- JWT deve carregar apenas dados mínimos: `sub`, `role`, `iat`, `exp`.
- Rotas administrativas devem validar token em middleware.

## 10. Modal no site institucional

### 10.1 Comportamento

1. O site carrega normalmente.
2. A configuração da campanha é consultada.
3. Se a campanha estiver ativa e o visitante ainda não tiver respondido, o modal abre após o primeiro conteúdo visível.
4. O visitante pode:
   - Preencher e enviar.
   - Clicar em "Agora não".
   - Fechar pelo botão.
   - Fechar com `Esc`.
5. O modal não bloqueia permanentemente a navegação.

### 10.2 Persistência local

Chaves sugeridas:

```text
radio88_registration_completed_<campaign-slug>
radio88_registration_dismissed_<campaign-slug>
```

Regras:

- Após sucesso, não mostrar novamente para aquela campanha no mesmo navegador.
- Após "Agora não", ocultar por período configurável ou até o fim da campanha.
- Nenhum dado pessoal deve ser salvo em `localStorage`.
- Se a campanha mudar de slug, a nova campanha pode ser exibida.

### 10.3 Campos

- Nome completo.
- Bairro.
- Cidade.
- Telefone opcional.
- Checkbox separado e opcional para receber comunicações/WhatsApp, caso essa finalidade seja aprovada.
- Confirmação de leitura do aviso de privacidade, conforme base legal e orientação jurídica definida.

O consentimento de marketing não pode vir pré-marcado.

### 10.4 Mobile First

Validar primeiro em 320px, 360px, 390px e 430px:

- Modal com altura máxima e rolagem interna.
- Inputs com fonte de pelo menos 16px para evitar zoom automático.
- Teclado correto para telefone.
- Botões com área confortável para toque.
- Botão de fechar sempre visível.
- Mensagens de erro próximas aos campos.
- Sem overflow horizontal.
- Foco preso no modal enquanto aberto.
- Retorno do foco ao elemento anterior ao fechar.

### 10.5 Estados da interface

- Carregando configuração.
- Formulário disponível.
- Enviando.
- Sucesso.
- Erro de validação.
- Erro de conexão com tentativa novamente.
- Campanha encerrada.

O modal não deve abrir se o endpoint de campanha falhar. O site continua disponível normalmente.

## 11. Painel administrativo React separado

### 11.1 Rota proposta

```text
/login
/ouvintes/cadastros
```

O painel não precisa ficar dentro do `cms-feitoamao`. Para esta etapa, criar uma aplicação React simples e independente, com build estático (`dist`) publicado em uma hospedagem do grupo GTF.

Domínio sugerido:

```text
https://cadastros-admin.<dominio-da-radio>
```

### 11.2 Funcionalidades do MVP

- Login com usuário e senha.
- Armazenamento do token JWT em memória ou `sessionStorage`, evitando persistência longa.
- Logout.
- Total de cadastros.
- Total com telefone.
- Cadastros por cidade.
- Tabela paginada em linhas.
- Busca por nome.
- Filtros por campanha, cidade, bairro e período.
- Exportar XLSX.
- Exportar CSV.
- Exibir data/hora e origem.
- Não mostrar dados além dos necessários.
- Exibir mensagem clara quando a sessão expirar.

### 11.3 Exportação

A API deve gerar o arquivo. O frontend não deve carregar todos os registros para montar Excel no navegador.

Regras:

- Exigir permissão `ouvintes.exportar`.
- Registrar usuário, filtros, formato e quantidade.
- Gerar arquivo temporário em memória ou storage temporário.
- Evitar URL pública permanente.
- Não enviar exportações por e-mail no MVP.
- Definir limite de linhas ou processamento assíncrono se o volume crescer.

### 11.4 Log de exportações administrativas

Toda exportação deve gerar registro em `registration_export_audit`.

Dados mínimos do log:

- Usuário administrativo.
- Formato exportado: `xlsx` ou `csv`.
- Filtros aplicados.
- Quantidade de linhas exportadas.
- Data e hora.
- IP ou hash do IP administrativo, se aprovado pela política de privacidade.

O painel deve ter uma visão simples de auditoria em fase posterior. No MVP, o log pode existir apenas no banco e ser consultado tecnicamente quando necessário.

### 11.5 Google Sheets opcional

Após o MVP, poderá existir:

- Botão administrativo "Sincronizar com planilha".
- Job agendado de espelhamento.
- Integração da API com conta de serviço.
- Aba somente para consulta operacional.

Nunca:

- Expor credenciais do Google no frontend.
- Enviar diretamente do navegador para a planilha.
- Usar a planilha como única cópia.

## 12. Banner e página futura de sorteios

O institucional poderá receber um banner clicável que abre:

```text
/sorteios
```

ou uma nova aba para uma landing page específica.

Essa fase deve consumir a configuração de uma campanha:

- Imagem do banner.
- Link.
- Data de início/fim.
- Regulamento.
- Situação ativa/inativa.
- Critérios de participação.

O banner não deve cadastrar automaticamente o usuário. A participação deve ocorrer em fluxo explícito.

## 13. Privacidade e LGPD

Nome, bairro, cidade, telefone, IP e identificadores de navegação podem ser dados pessoais. A solução deve seguir finalidade, necessidade, transparência, segurança e controle de acesso.

### 13.1 Antes do lançamento

Definir com a responsável da empresa e, idealmente, revisão jurídica:

- Quem é o controlador dos dados.
- Finalidade exata do cadastro.
- Base legal aplicável.
- Se haverá contato por WhatsApp.
- Prazo de retenção.
- Com quem os dados poderão ser compartilhados.
- Canal para correção, acesso e exclusão.
- Texto do aviso de privacidade.
- Regulamento separado se houver sorteio.

### 13.2 Regras técnicas

- Coletar apenas os campos necessários.
- Não enviar nome, telefone, bairro ou cidade ao GA4.
- Usar HTTPS.
- Criptografar comunicação e backups.
- Restringir banco à rede da API.
- Senha forte e usuário de banco com menor privilégio.
- Não registrar telefone/nome em logs de aplicação.
- Não expor stack trace em produção.
- Auditar exportações.
- Definir rotina de exclusão/anonimização após o prazo aprovado.
- Manter canal para solicitação do titular.

### 13.3 Retenção proposta para decisão

Sugestão inicial:

- Manter os dados operacionais durante a campanha e período de atendimento.
- Revisar em 90 ou 180 dias.
- Excluir ou anonimizar registros sem finalidade ativa.
- Manter apenas estatísticas agregadas quando possível.

O prazo definitivo deve ser aprovado pela empresa e documentado no aviso de privacidade.

### 13.4 Referências oficiais

- [Aviso de Privacidade da ANPD](https://www.gov.br/anpd/pt-br/acesso-a-informacao/aviso-de-privacidade)
- [Regulamento para agentes de tratamento de pequeno porte](https://www.gov.br/anpd/pt-br/acesso-a-informacao/institucional/atos-normativos/regulamentacoes_anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022)
- [Guia de Segurança da Informação da ANPD](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-publica-guia-de-seguranca-para-agentes-de-tratamento-de-pequeno-porte)

Este PRD não substitui revisão jurídica.

## 14. Segurança da API pública

- Rate limiting por IP/hash e campanha.
- Limite de tamanho do body.
- Validação server-side.
- Honeypot invisível como primeira proteção antispam.
- Cloudflare Turnstile ou equivalente se houver abuso.
- CORS apenas para domínios autorizados.
- Idempotência com `submissionToken`.
- Sanitização para evitar fórmulas perigosas em CSV/XLSX.
- Headers de segurança.
- Logs estruturados sem PII.
- Alertas para aumento anormal de erros ou cadastros.
- Bloqueio de métodos HTTP não utilizados.

## 15. Infraestrutura de publicação

### 15.1 Opção preferida

- Front institucional: hospedagem atual/Vercel.
- Painel administrativo React: build `dist` publicado em hospedagem estática do grupo GTF.
- API de cadastros Node.js: container Docker ou serviço `systemd` em VPS.
- PostgreSQL: serviço gerenciado com SSL e backup automático, se o orçamento permitir.
- Reverse proxy: Nginx/Apache do servidor.
- Domínio sugerido: `cadastros-api.<dominio-da-radio>`.

### 15.2 Opção econômica em VPS

Docker Compose separado:

```text
radio88-cadastros-api
radio88-cadastros-postgres
radio88-cadastros-admin (opcional se servido pelo mesmo Nginx)
```

Requisitos:

- Volume persistente fora do diretório de deploy.
- PostgreSQL não exposto publicamente.
- API e banco em rede Docker privada.
- `pg_dump` diário.
- Cópia de backup fora da VPS.
- Teste de restauração antes do lançamento.
- Limites de CPU/memória.
- Healthcheck.
- Reinício automático.

### 15.3 Variáveis de ambiente

API:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://radio88_user:<secret>@postgres:5432/radio88_cadastros
JWT_SECRET=<secret-forte>
JWT_EXPIRES_IN=2h
CORS_ALLOWED_ORIGINS=https://site-da-radio,https://cadastros-admin.dominio
REGISTRATION_RATE_LIMIT_PER_MINUTE=5
IP_HASH_SECRET=<secret>
EXPORT_MAX_ROWS=50000
```

Institucional:

```env
VITE_CADASTROS_API_URL=https://cadastros-api.dominio
VITE_CADASTRO_CAMPAIGN_SLUG=lancamento-institucional-2026
```

Painel administrativo React:

```env
VITE_CADASTROS_API_URL=https://cadastros-api.dominio
```

Segredos não entram no Git.

## 16. Backup e continuidade

### 16.1 Política mínima

- Backup automático diário.
- Backup manual antes da abertura da campanha.
- Backup manual ao final do dia 1º de agosto.
- Retenção de múltiplas cópias.
- Uma cópia fora da VPS.
- Arquivos criptografados.
- Procedimento de restauração documentado.

### 16.2 Teste obrigatório

Não basta gerar `pg_dump`. Antes do lançamento:

1. Criar banco PostgreSQL temporário.
2. Restaurar o backup.
3. Validar contagem e integridade.
4. Registrar duração e comandos.

### 16.3 Procedimento operacional sugerido

Backup manual:

```bash
pg_dump "$DATABASE_URL" \
  --format=custom \
  --file=backups/radio88-cadastros-$(date +%Y%m%d-%H%M%S).dump
```

Restauração em banco temporário:

```bash
createdb radio88_cadastros_restore_test
pg_restore \
  --dbname=radio88_cadastros_restore_test \
  --clean \
  --if-exists \
  backups/<arquivo>.dump
```

Validações mínimas após restauração:

- Quantidade de campanhas.
- Quantidade de cadastros por campanha.
- Quantidade de exportações auditadas.
- Amostragem de registros com acentos.
- Verificação de índices principais.

### 16.4 Responsabilidade operacional

Antes da publicação, definir:

- Quem executa backup manual no dia do lançamento.
- Onde os arquivos ficam armazenados fora da VPS.
- Quem tem acesso ao backup.
- Qual é o prazo de retenção dos arquivos.
- Como registrar que o teste de restauração foi executado.

## 17. Observabilidade

Métricas técnicas:

- Cadastros por minuto/hora.
- Taxa de sucesso.
- Erros `400`, `409`, `429` e `500`.
- Latência p50/p95.
- Conexões do PostgreSQL.
- Espaço em disco.
- Último backup válido.

Eventos GA4, sem PII:

- `listener_registration_modal_view`
- `listener_registration_start`
- `listener_registration_submit`
- `listener_registration_success`
- `listener_registration_skip`
- `listener_registration_error`

Parâmetros permitidos:

- `campaign_slug`
- `source`
- `error_type`

Não enviar nome, telefone, cidade ou bairro ao Analytics.

## 18. Testes

### 18.1 Backend Node.js

- Vitest ou Jest para regras e validações.
- Supertest para endpoints HTTP.
- Testes de integração com PostgreSQL real em container de teste.
- Cadastro válido sem telefone.
- Cadastro válido com telefone.
- Rejeição de campos obrigatórios vazios.
- Normalização de telefone.
- Campanha inativa/encerrada.
- Idempotência.
- Rate limiting.
- Autorização administrativa.
- Paginação e filtros.
- Exportação com caracteres acentuados.
- Neutralização de fórmula em XLSX/CSV.

### 18.2 Front institucional

- Vitest + Testing Library.
- Modal abre somente em campanha ativa.
- "Agora não" fecha e persiste decisão.
- Cadastro concluído não reabre.
- Validação dos obrigatórios.
- Telefone opcional.
- Estados de loading, sucesso e erro.
- Acessibilidade de teclado.
- Mobile 320px, 360px, 390px e 430px.

### 18.3 Painel administrativo React

- Login.
- Proteção de rotas.
- Expiração do token.
- Filtros.
- Paginação.
- Erros da API.
- Download de arquivo.
- Logout.

### 18.4 Carga

Executar teste de carga moderado no endpoint público antes do lançamento:

- Pico estimado de acessos simultâneos.
- Validação de latência.
- Validação do pool de conexões.
- Validação de rate limiting.
- Confirmação de que o site continua funcionando se a API de cadastros falhar.

## 19. Cronograma proposto para 15 dias

### D-15 a D-13: decisões e fundação

- Aprovar finalidade, texto, retenção e campanha.
- Definir hospedagem do PostgreSQL.
- Criar estrutura do serviço Node.js e painel React.
- Criar banco e ambientes.
- Definir contrato da API.

### D-12 a D-10: banco e API pública

- Criar schema.
- Implementar campanha.
- Implementar cadastro público.
- Implementar validação, idempotência e rate limiting.
- Criar testes.

### D-9 a D-8: modal institucional

- Implementar modal Mobile First.
- Integrar endpoint de campanha.
- Integrar cadastro.
- Implementar persistência de dispensado/concluído.
- Instrumentar eventos GA4 sem PII.

### D-7 a D-6: painel administrativo React

- Criar rota protegida.
- Criar login com JWT.
- Criar tabela, filtros e paginação.
- Implementar exportação XLSX/CSV.
- Implementar auditoria de exportações.

### D-5 a D-4: infraestrutura e segurança

- Deploy de homologação.
- HTTPS, CORS e secrets.
- Backup.
- Teste de restauração.
- Revisão de LGPD e segurança.

### D-3 a D-2: QA completo

- Mobile, desktop e navegadores.
- Testes de carga.
- Teste de indisponibilidade da API.
- Validação das planilhas exportadas.
- Correções.

### D-1: preparação

- Backup inicial.
- Congelamento de mudanças não essenciais.
- Ativação programada da campanha.
- Checklist operacional.
- Definir responsável por monitorar o lançamento.

### D0: 1º de agosto

- Monitorar API, banco, erros e cadastros.
- Validar exportação.
- Fazer backup ao final do dia.
- Registrar incidentes e decisões.

### D+1 a D+7

- Revisar qualidade dos dados.
- Deduplicação apenas para relatório, sem exclusão automática.
- Gerar relatório.
- Decidir integração opcional com Google Sheets.
- Planejar fase de cadastro unificado.

## 20. Fases de implementação

### Fase 0 - Aprovação de produto e privacidade

- Finalidade.
- Texto do modal.
- Aviso de privacidade.
- Retenção.
- Responsáveis.
- Definição se haverá marketing e/ou sorteio.

### Fase 1 - PostgreSQL e API pública

- Schema.
- Campanha.
- Cadastro.
- Segurança.
- Testes.

### Fase 2 - Modal no institucional

- UI Mobile First.
- Integração.
- Acessibilidade.
- Analytics sem PII.

### Fase 3 - Painel administrativo e exportação

- Login e JWT.
- Listagem.
- Filtros.
- XLSX/CSV.
- Auditoria.

### Fase 4 - Deploy e lançamento

- Produção.
- Backups.
- Monitoramento.
- QA.
- Runbook.

### Fase 5 - Evolução pós-lançamento

- Perfil unificado do ouvinte.
- Identidades verificadas.
- Integração com aplicativo.
- Preferências de comunicação.
- Campanhas e sorteios.
- Banner e landing page.
- Integração opcional com planilha corporativa.

## 21. Critérios de aceite do MVP

- [ ] Modal aparece apenas quando a campanha estiver ativa.
- [ ] O visitante consegue fechar ou escolher "Agora não".
- [ ] Nome, bairro e cidade são obrigatórios.
- [ ] Telefone é opcional.
- [ ] A API valida todas as regras independentemente do frontend.
- [ ] Reenvio da mesma submissão não gera duplicata.
- [ ] O site continua utilizável se a API estiver indisponível.
- [ ] PostgreSQL é a fonte oficial.
- [ ] Banco não está exposto à internet.
- [ ] Endpoints administrativos exigem autenticação e permissão.
- [ ] Painel administrativo lista registros de forma paginada.
- [ ] Painel administrativo filtra por campanha, data, cidade e bairro.
- [ ] Exportações XLSX e CSV funcionam com acentos.
- [ ] Exportações são auditadas.
- [ ] Nenhum dado pessoal é enviado ao GA4.
- [ ] Rate limiting e proteção antispam estão ativos.
- [ ] Aviso de privacidade está disponível.
- [ ] Backup e restauração foram testados.
- [ ] QA mobile e desktop foi concluído.
- [ ] Build e testes das aplicações afetadas passam.

## 22. Riscos e mitigação

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Prazo de 15 dias | Alto | Congelar escopo no MVP e deixar integrações extras para D+1 |
| Pico de acessos no lançamento | Alto | Teste de carga, pool de conexão, healthcheck e monitoramento |
| Spam/cadastros automatizados | Alto | Rate limiting, honeypot e Turnstile se necessário |
| Vazamento por planilha | Alto | Banco como fonte, acesso restrito e exportação auditada |
| Dados duplicados | Médio | Idempotência e relatório de possíveis duplicidades |
| Telefone opcional impedir identidade única | Médio | Tratar como submissão no MVP; unificação apenas na fase futura |
| Indisponibilidade da API bloquear o site | Alto | Modal deve falhar silenciosamente e nunca bloquear a Home |
| Uso indevido para marketing | Alto | Finalidade clara e opt-in separado |
| Backup existir, mas não restaurar | Alto | Teste real de restauração antes do lançamento |
| Mudança de campanha exigir deploy | Médio | Configuração de campanha no banco/API |

## 23. Arquivos e projetos previstos

Novos:

```text
radio88-cadastros/
├── api/
├── admin/
├── database/
└── docs/
plans/plans-cadastrosorteio/
docs/listener-registration.md
docs/listener-registration-deploy.md
```

Alterados:

```text
radio-88-fm-institucional/
agents/README.md                  # somente se surgir novo papel
docs/README.md
docs/architecture.md
docs/deploy.md
```

O `cms-feitoamao` não precisa ser alterado no MVP, pois o painel administrativo será uma aplicação React separada.

Não alterar no MVP, salvo necessidade aprovada:

```text
gtf-news/
PortalGtf/                        # permanece responsável pelo domínio atual
BancodeDadosPortalGTF.sql         # MySQL não recebe as tabelas deste serviço
```

O schema PostgreSQL deve ficar em arquivo próprio dentro do novo serviço.

## 24. Pendências para aprovação antes da implementação

1. Qual será o domínio oficial da API de cadastros?
2. PostgreSQL gerenciado ou container na VPS?
3. Qual é a finalidade textual exata do cadastro?
4. A rádio pretende entrar em contato por WhatsApp?
5. O checkbox de marketing fará parte do lançamento?
6. Qual será o prazo de retenção?
7. Quem terá acesso ao painel e à exportação?
8. O cadastro já valerá para algum sorteio ou será apenas base de ouvintes?
9. Qual texto/título/arte será usado no modal?
10. A planilha corporativa será apenas exportada ou também sincronizada?

## 25. Recomendação final

Para o lançamento, implementar:

1. PostgreSQL dedicado.
2. API Node.js independente.
3. Modal opcional no institucional.
4. Painel administrativo React separado com login/senha e JWT.
5. Exportação XLSX/CSV.
6. Backup fora da VPS.
7. Campanha configurável.

A planilha corporativa pode ser adicionada depois como espelho de conveniência. O banco e a API devem ser construídos desde o início como a fonte oficial, pois isso entrega segurança agora e mantém um caminho claro para aplicativo, sorteios e relacionamento contínuo com ouvintes.
