# Visao geral

O **GestaoOuvintes** e um sistema separado para capturar, consultar e exportar cadastros de ouvintes da Radio 88 FM.

Ele foi criado para a campanha de lancamento do institucional, com uma base tecnica preparada para evoluir depois para um cadastro mais robusto de ouvintes no site, aplicativo e outras frentes.

## Objetivo de produto

- Receber cadastros basicos de ouvintes.
- Permitir que a equipe administrativa consulte os cadastros.
- Exportar dados em CSV/XLSX para operacao e sorteios.
- Manter campanha, privacidade, auditoria e seguranca sob controle.

## Dados principais

Campos de cadastro do ouvinte:

- Nome: obrigatorio.
- Bairro: obrigatorio.
- Cidade: obrigatorio.
- Telefone: opcional.

Campos tecnicos:

- Campanha.
- Token de idempotencia.
- Versao do aviso de privacidade.
- Origem.
- UTM.
- Hash HMAC do IP.
- User agent resumido.

## Componentes

- `api-ouvintes`: API Node.js com PostgreSQL, regras de negocio, autenticacao administrativa e exportacoes.
- `painel-adm`: painel web em React para gestao de campanhas e cadastros.

## Principios

- Separar cadastro de ouvintes do CMS/portal principal.
- Evitar dependencia de planilha como fonte primaria.
- Nunca versionar segredos.
- Tratar dados pessoais como informacao sensivel.
- Exportar pelo backend, com auditoria.
- Projetar interface administrativa em Mobile First.
