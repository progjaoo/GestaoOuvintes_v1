# Seguranca e privacidade

O sistema manipula dados pessoais de ouvintes. Toda alteracao deve preservar confidencialidade, integridade e rastreabilidade.

## Dados pessoais

Campos tratados como sensiveis:

- nome;
- telefone;
- bairro;
- cidade;
- token de submissao;
- JWT;
- senha;
- exportacoes CSV/XLSX.

## Regras obrigatorias

- Nunca versionar `.env` real.
- Nunca logar senha, JWT ou corpo completo de cadastro/exportacao.
- Nunca enviar PII para GA4, analytics ou ferramentas externas.
- Nunca expor PostgreSQL publicamente.
- Usar HTTPS em producao.
- Restringir CORS aos dominios reais.
- Exportacoes devem ser geradas pela API e auditadas.
- Senhas devem continuar usando Argon2id.

## Autenticacao

- Login administrativo via JWT.
- Token salvo apenas em memoria/sessionStorage no painel.
- `401` deve encerrar sessao no frontend.
- Permissoes sensiveis devem ser validadas no backend.

## Bootstrap de admin

O endpoint de bootstrap so pode criar admin quando `admin_user` esta vazio.

Esse fluxo existe para evitar ficar sem acesso em um ambiente novo, mas nao substitui uma rotina completa de gestao de usuarios.

## Privacidade do cadastro publico

- O cadastro exige aceite do aviso de privacidade.
- A API valida `privacyNoticeVersion`.
- IP bruto nao e armazenado; apenas hash HMAC.
- `website` funciona como honeypot e deve permanecer vazio no frontend.

## Exportacao

- CSV/XLSX deve neutralizar formulas.
- Toda exportacao gera registro em `registration_export_audit`.
- Acesso a exportacao deve ser restrito a `admin`.
