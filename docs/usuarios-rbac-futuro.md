# Usuários administrativos e RBAC - implementação futura

## Contexto

O painel administrativo do Sistema de Gestão de Ouvintes hoje utiliza usuário administrador já provisionado. A criação de login e senha pelo próprio painel deve ser implementada em etapa futura, com controle de permissões e auditoria.

## Diretriz

Não deve existir cadastro público de usuários administrativos. A criação de usuários deve acontecer apenas dentro do painel, por um usuário com papel `admin`.

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

## Fora da entrega atual

Esta documentação não implementa a tela de usuários. Ela registra a decisão de produto e arquitetura para evitar uma solução insegura de cadastro administrativo aberto.
