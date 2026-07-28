# Contrato da API

Base local:

```text
http://127.0.0.1:3010
```

## Respostas de erro

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Dados invalidos.",
  "fields": [
    {
      "path": "name",
      "message": "Too small: expected string to have >=2 characters"
    }
  ]
}
```

O painel deve usar `code` para decisões e `message` para feedback ao usuário.

## Saúde

### `GET /health`

Verifica o processo HTTP sem depender do banco.

### `GET /ready`

Verifica HTTP e conexão PostgreSQL.

## Público

### `GET /api/public/campaigns/:slug`

Retorna campanha ativa:

```json
{
  "slug": "lancamento-institucional-2026",
  "active": true,
  "title": "Faca parte da historia da Radio 88 FM",
  "description": "Cadastre-se para participar desta nova fase da Radio 88 FM.",
  "privacyNoticeVersion": "2026-08-01",
  "privacyNoticeUrl": "/privacidade",
  "termsUrl": null,
  "startsAt": "2026-07-01T03:00:00.000Z",
  "endsAt": "2026-09-01T02:59:59.000Z"
}
```

Campanha ausente, pausada, futura ou encerrada:

```json
{
  "slug": "campanha",
  "active": false
}
```

### `POST /api/public/listener-registrations`

```json
{
  "campaignSlug": "lancamento-institucional-2026",
  "name": "Nome do ouvinte",
  "neighborhood": "Bairro",
  "city": "Cidade",
  "phone": "24999999999",
  "submissionToken": "9dcc6af2-121f-45ce-b271-11a3b5e11f70",
  "privacyNoticeVersion": "2026-08-01",
  "privacyAcknowledged": true,
  "marketingOptIn": false,
  "source": "institutional_web",
  "website": "",
  "utm": {
    "source": null,
    "medium": null,
    "campaign": null,
    "content": null
  }
}
```

- `201`: criado.
- `200`: token já processado, sem duplicação.
- `400`: validação.
- `409`: campanha fechada, aviso de privacidade divergente ou telefone que ja
  participa da mesma campanha.
- `429`: limite excedido.

`website` é o honeypot e deve permanecer vazio.

### Campanha compartilhada entre site e aplicativo

O placement público `institutional_modal` é compartilhado. Uma campanha
publicada nele pelo `painel-adm` é a mesma campanha resolvida pelo site
institucional e pelo aplicativo nativo. Os clientes não devem manter um slug ou
placement alternativo para o mobile.

Plataformas aceitas:

```text
web_mobile | web_desktop | web_tablet | expo_ios | expo_android
```

Todas as rotas de sessão exigem:

```http
X-Device-Token: <UUID opaco e persistente>
X-Platform: expo_ios
Accept: application/json
Content-Type: application/json
```

Use `expo_android` no Android. O token identifica o dispositivo, não deve
conter PII e precisa ter entre 32 e 256 caracteres.

### `POST /api/public/session/resolve`

Resolve campanha, perfil, participação e eventual dismissal do dispositivo:

```json
{
  "placement": "institutional_modal",
  "platform": "expo_ios"
}
```

Resposta:

```json
{
  "placement": "institutional_modal",
  "placementVersion": 4,
  "campaign": {
    "id": "7fa12ad8-7200-40cb-aa44-90a044f6fd12",
    "slug": "campanha-ativa",
    "active": true,
    "title": "Faça parte da Rádio 88",
    "description": "Cadastre-se para participar.",
    "privacyNoticeVersion": "2026-08-01",
    "privacyNoticeUrl": "/privacidade",
    "termsUrl": null,
    "startsAt": "2026-08-01T03:00:00.000Z",
    "endsAt": null
  },
  "listenerState": "anonymous",
  "experience": "anonymous_registration_required",
  "participation": null,
  "dismissedUntil": null
}
```

Experiências possíveis:

```text
anonymous_registration_required
known_listener_confirmation_required
already_participating
campaign_unavailable
```

### `POST /api/public/listeners/register-and-participate`

Cadastra um ouvinte anônimo, vincula o dispositivo e cria sua participação:

```http
Idempotency-Key: 9dcc6af2-121f-45ce-b271-11a3b5e11f70
X-Device-Token: 8ad9ca49-c21d-49fc-a1f7-34710542ae50
X-Platform: expo_ios
```

```json
{
  "campaignId": "7fa12ad8-7200-40cb-aa44-90a044f6fd12",
  "name": "Nome do ouvinte",
  "neighborhood": "Bairro",
  "city": "Cidade",
  "phone": "24999999999",
  "submissionToken": "9dcc6af2-121f-45ce-b271-11a3b5e11f70",
  "privacyNoticeVersion": "2026-08-01",
  "privacyAcknowledged": true,
  "marketingOptIn": false,
  "source": "expo",
  "website": ""
}
```

- `201` com `status: "created"`: cadastro e participação criados.
- `200` com `status: "already_processed"`: a mesma idempotency key já foi
  processada, sem duplicar perfil, cadastro ou participação.
- `409 PHONE_ALREADY_PARTICIPATING`: o telefone normalizado ja possui cadastro
  ativo na mesma campanha. A mensagem publica e
  `Você já está participando do sorteio.`. O mesmo telefone pode participar de
  outra campanha.
- A origem persistida é `expo_ios` ou `expo_android`, conforme `X-Platform`.

### Acoes dos banners institucionais

As respostas administrativas e
`GET /api/public/institutional-banners?placement=home_hero` incluem
`actionType`:

```text
none | external_url | listener_registration_modal
```

- `none`: `destinationUrl` deve ser nulo e o banner nao e interativo.
- `external_url`: exige uma URL HTTPS e pode usar `openInNewTab`.
- `listener_registration_modal`: `destinationUrl` e nulo,
  `openInNewTab` e falso e o institucional consulta a sessao publica antes de
  abrir o modal da campanha.

Banners antigos sem `actionType` continuam compativeis: URL existente e
interpretada como `external_url`; sem URL, como `none`.

### `POST /api/public/campaigns/:campaignId/participations`

Cria a participação de um dispositivo que já possui perfil. Não recebe PII no
body. Retorna `201` quando cria e `200` quando a participação já existia.

### `PUT /api/public/campaigns/:campaignId/device-state`

Registra abertura do modal:

```json
{
  "incrementOpenCount": true
}
```

Também aceita `dismissedUntil` como data ISO com fuso ou `null`. O app atualmente
faz dismissal apenas em memória, mas respeita um `dismissedUntil` futuro
retornado pela sessão.

Erros relevantes para os clientes:

- `400 DEVICE_TOKEN_REQUIRED` ou `VALIDATION_ERROR`;
- `409 CAMPAIGN_CLOSED` ou `CAMPAIGN_UNAVAILABLE`;
- `409 PRIVACY_NOTICE_VERSION_MISMATCH`;
- `409 LISTENER_PROFILE_REQUIRED`;
- `429 RATE_LIMIT_EXCEEDED`.

## Autenticação administrativa

### `POST /api/admin/auth/login`

```json
{
  "username": "admin",
  "password": "senha"
}
```

Resposta:

```json
{
  "accessToken": "<jwt>",
  "expiresIn": "2h",
  "user": {
    "id": "<uuid>",
    "name": "Administrador Radio 88",
    "username": "admin",
    "role": "admin"
  }
}
```

### `GET /api/admin/auth/me`

Header:

```http
Authorization: Bearer <jwt>
```

### `POST /api/admin/auth/logout`

Retorna `204`. O JWT é stateless; o painel deve apagar o token da sessão.

## Campanhas administrativas

Todas exigem JWT.

- `GET /api/admin/campaigns`
- `POST /api/admin/campaigns` - função `admin`.
- `PUT /api/admin/campaigns/:id` - função `admin`.

Status aceitos:

```text
draft | active | paused | closed
```

## Cadastros administrativos

### `GET /api/admin/listener-registrations`

Query params:

- `page`, default `1`.
- `pageSize`, default `20`, máximo `100`.
- `campaignId`.
- `startDate`, ISO 8601 com fuso.
- `endDate`, ISO 8601 com fuso.
- `city`.
- `neighborhood`.
- `name`.
- `hasPhone=true|false`.

Resposta:

```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

### `GET /api/admin/listener-registrations/:id`

Retorna o detalhe necessário ao painel.

### `GET /api/admin/listener-registrations/export`

Exige função `admin`.

Query params:

- Todos os filtros da listagem.
- `format=csv|xlsx`.

A API gera download e cria registro em `registration_export_audit`.

## Regras para o futuro `painel-adm`

- Guardar JWT em memória ou `sessionStorage`.
- Nunca persistir senha.
- Em `401`, encerrar sessão e voltar ao login.
- Não montar Excel no navegador.
- Não carregar todas as páginas para exportar.
- Não enviar PII ao GA4 ou logs do frontend.
- Tratar `429` no login sem repetir automaticamente.
