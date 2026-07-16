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
- `409`: campanha fechada ou aviso de privacidade divergente.
- `429`: limite excedido.

`website` é o honeypot e deve permanecer vazio.

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
