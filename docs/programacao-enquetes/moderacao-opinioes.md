# Opinioes privadas e protecao de linguagem

## Decisao do usuario em 11/11/2026

Enquetes como o exemplo recebido podem usar Sim/Nao, permitir identificacao opcional e receber uma opiniao privada. A equipe controla a janela e o programa/edicao. Nao e um mural publico nem um cadastro automatico para marketing. A escolha Sim/Nao nao deve depender de identificacao quando esta for opcional.

## Incremento implementado

participation-language-policy.ts e uma funcao pura de primeira passagem: normaliza acentos, caixa, alguns caracteres invisiveis e substituicoes numericas comuns; compara tokens inteiros com uma lista inicial de profanidades. Discordancia respeitosa e assuntos religiosos nao sao bloqueados por opiniao ou posicao. Retorno nunca reproduz mensagem ou token ofensivo.

Dez testes cobrem mensagens civis, limite de palavra, acentos/invisiveis e alguns disfarces. Nao garante detectar toda ofensa, ameaca, preconceito, ironia ou ataque contextual. Ha risco de falso positivo e falso negativo. Nao chamar de moderacao infalivel nem usar como unica protecao.

IMPORTANTE: neste incremento a funcao ainda nao esta ligada a uma rota de participacao publica, inexistente. Nao afirmar que o site ja bloqueia mensagens. A integracao abaixo e requisito da proxima entrega T10.

## Requisitos ao ligar a rota publica

- Validar tamanho/texto simples, permissao da janela pelo relogio do servidor e limite de abuso antes de gravar.
- Se a linguagem for bloqueada, retornar erro de validacao amigavel e pedir reformulacao. Nao imprimir conteudo em logs nem enviar a analytics/R2.
- Voto e mensagem devem ter contratos/idempotencia claros; nao confirmar gravacao de opiniao rejeitada nem duplicar voto em retry. Interface preserva o texto apenas em memoria para permitir corrigir.
- Nome e contato opcionais conforme politica da enquete. Telefone conhecido nao autentica, nao revela perfil e nao autoriza merge de ouvintes.
- Somente equipe com participation.read no programa ve opinioes; moderação exige participation.moderate; contato completo/exportacao exigem concessoes distintas.
- Revisao humana com estados received/reviewed/selected/rejected; selecionar para leitura no ar nao publica automaticamente mensagem ou identidade no site.
- Revogar vinculo/usuario interrompe a proxima consulta; nao guardar cache de mensagens privadas apos perda de acesso.
- Qualquer armazenamento futuro de conteudo bloqueado exige finalidade, retencao e acesso explicitamente aprovados; default nao armazenar.

## Conteudo de exemplo para rascunho

- Contexto: Um cristao casado deve ter cuidado com as series que assiste?
- Pergunta: Uma mulher que comeca a comparar o marido com os homens romanticos que aparecem nos doramas pode colocar seu casamento em risco?
- Alternativas: Sim; Nao.
- Identificacao: opcional.
- Opiniao: permitida, privada.
- Programa/edicao: aguardando confirmacao do usuario; nao inferir pela imagem nem publicar automaticamente.

A imagem e uma referencia fornecida pelo usuario, nao autorizacao para copiar midias ou importar participantes do Instagram.

## Incremento administrativo aprovado posteriormente

Table e Sheet de Participacoes acrescentam consulta privada e mudanca de estado em received/reviewed/selected/rejected; nao recebem opinioes do publico. O estado recebido nao pode ser reatribuido na remoderacao. Original e origem imutaveis inclusive no banco; nota interna separada, nunca divulgada. Nota omitida em PATCH preserva a existente; string vazia limpa explicitamente. Regras de read/moderate independentes e escopo por programa sao detalhadas em participation-admin-contract.md. A funcao lexical continua sem endpoint publico integrado. Nao usar uma fixture como evidencia de que o ouvinte ja consegue enviar mensagens.
