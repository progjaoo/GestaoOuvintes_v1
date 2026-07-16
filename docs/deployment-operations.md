# Deploy e operacao

## API

Recomendacao:

- Publicar API em ambiente Node.js ou container Docker.
- Manter PostgreSQL em rede privada.
- Usar proxy reverso com HTTPS.
- Expor somente porta HTTP da API.

Antes de publicar:

- Trocar `JWT_SECRET`.
- Trocar `IP_HASH_SECRET`.
- Trocar senha do PostgreSQL.
- Trocar `ADMIN_INITIAL_PASSWORD`.
- Configurar `CORS_ALLOWED_ORIGINS` com dominios reais.
- Remover exposicao publica da porta `5432`.
- Testar `/health` e `/ready`.

## Painel

Pode ser publicado como SPA estatica:

- Vercel.
- Netlify.
- Nginx.
- CDN com fallback para `index.html`.

Variavel obrigatoria:

```env
VITE_CADASTROS_API_URL=https://api-cadastros.dominio
```

## Backup

Executar periodicamente:

```bash
cd GestaoOuvintes/api-ouvintes
./scripts/backup.sh
```

Boas praticas:

- Copiar backup para fora da VPS.
- Criptografar backup.
- Testar restore.
- Registrar horario e responsavel.

## Monitoramento minimo

- API respondendo `/health`.
- API respondendo `/ready`.
- Banco com backup recente.
- Erros 5xx.
- Tentativas de login e rate limit.
- Volume de cadastros por campanha.

## Rollback

Migrações sao forward-only.

Para rollback operacional:

1. Pausar escrita.
2. Restaurar backup em banco novo.
3. Ajustar `DATABASE_URL`.
4. Validar `/ready`.
5. Reabrir trafego.
