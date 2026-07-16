# Mobile First

O painel administrativo deve funcionar bem em telas pequenas. Mesmo sendo uma ferramenta operacional, parte do uso pode acontecer por celular.

## Breakpoints de validacao

Validar no minimo:

- 320px.
- 360px.
- 390px.
- 430px.
- 768px.
- 1280px ou superior.

## Regras de interface

- Comece o layout pelo mobile e expanda para desktop.
- Tabelas devem ter alternativa em cards no mobile.
- Botoes devem ter area de toque confortavel.
- Filtros devem continuar utilizaveis em telas pequenas.
- Dialogos devem ter rolagem interna.
- Nao depender de hover para acao essencial.
- Textos longos devem quebrar linha sem overflow horizontal.

## Painel administrativo

Comportamento esperado:

- Sidebar desktop vira navegacao adaptada no mobile.
- Listagens priorizam nome, cidade, bairro e telefone.
- Acoes sensiveis continuam visiveis, mas sem poluir a tela.
- Exportacao pode ficar em menu/acao secundaria quando necessario.

## QA visual

Antes de entregar telas novas:

- Testar com teclado.
- Testar toque em celular ou em modo responsivo.
- Conferir se nao existe scroll horizontal.
- Conferir estados vazio, loading e erro.
- Conferir contraste dos textos.
