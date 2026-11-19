# Usuários administrativos e RBAC - registro histórico

> **Status:** este documento registra decisões anteriores e não descreve o estado atual. A administração de usuários, papéis, permissões e exceções individuais já possui implementação no código e nas migrações do Gestão. Consulte [Painel administrativo](frontend-admin.md), [Backend API](backend-api.md), [Arquitetura](architecture.md) e [Segurança e privacidade](security-privacy.md) para as regras atuais.

## Contexto

Este contexto descrevia uma etapa anterior, quando o painel utilizava apenas um administrador provisionado. Ele foi superado pela implementação de identidade administrativa, RBAC, auditoria e gestão de acessos.

## Diretriz

Não deve existir cadastro público de usuários administrativos. A criação e manutenção de usuários internos ocorre por fluxos administrativos autorizados; a API valida permissões e escopos.

## Papéis iniciais sugeridos

- `admin`: acesso total, incluindo campanhas, banners, exportações, usuários e configurações.
- `recepcionista`: cadastro e consulta de ouvintes, contato via WhatsApp, sem acesso a configurações críticas.
- `locutor`: consulta controlada de campanhas e participantes, sem exportação completa por padrão.
- `visualizador`: acesso somente leitura a métricas e listagens permitidas.

## Fluxo recomendado

1. Admin acessa menu `Usuários`.
2. Admin cria usuário com nome, e-mail/username e papel.
3. Sistema gera senha temporária ou convite por e-mail.
4. Usuário troca a senha no primeiro acesso.
5. Toda criação, alteração de papel e desativação gera auditoria.

## Requisitos de segurança

- Senha forte obrigatória.
- Hash com Argon2 ou equivalente já aprovado no backend.
- Rate limit no login.
- Bloqueio/desativação sem remoção física para preservar auditoria.
- Permissões sempre validadas no backend, nunca apenas no frontend.
- Futuramente avaliar MFA para admins.

## Registro legado

As sugestões de papéis deste documento são históricas e não substituem o catálogo de permissões, os papéis ou as regras efetivas armazenadas no sistema. Não use este arquivo isoladamente para conceder acesso.
