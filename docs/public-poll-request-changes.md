# Ajustes de produto - enquetes e mensagens

11/11/2026, substitui o desenho de moderacao obrigatoria aprovado no incremento anterior.

- Participacoes textuais pertencem a enquete. Menu e workspace integrados em Enquetes, resultados e mensagens lado a lado/abas responsive. Nao ha nova fila obrigatoria de aprovacao; mensagens recebidas ficam visiveis imediatamente a equipe com participation.read, sem alterar o original. A equipe decide o que le no ar. Dados e estados legados sao preservados; nao apagar historico para retirar um workflow.
- Formatos vote/message/mixed distinguem voto em alternativa e texto; uma mensagem nao cria um voto ficticio. Texto privado, sem filtro lexical automatico neste recorte por decisao expressa do usuario. Limites e rate limit continuam necessarios; isso nao constitui garantia contra abuso ou ataques.
- Slug assistido pela pergunta antes da edicao manual/registro criado. Alternativas como linhas de formulario inspiradas no WhatsApp, sem importar marca/arquivos ou copiar infraestrutura.
- Formulario publico com identificacao opcional e perfil persistido nas tabelas existentes listener_profile/listener_device. Reconhecimento seguro pelo token existente de dispositivo; telefone sozinho nao comprova identidade nem permite revelar ou fundir cadastros. Outro dispositivo precisa de recuperacao/verificacao futura. Sem conta Clerk obrigatoria e sem opt-in automatico de marketing.
- CTA PARTICIPE DO PROGRAMA substitui ouvir somente no componente No Ar da Home, quando houver enquete disponivel para o programa vigente. Header/player nao mudam. Arte de referencia fornecida pelo usuario; demo exclusivamente local.
- Ponte publica LOCAL usa snapshot em arquivo/memoria, flag exclusiva de local; visitas nao consultam PostgreSQL. Escritas de identidade/submissao sao interacoes explicitas. Nao afirmar que esta ponte ja e release R2/Vercel pronto.

A documentacao fase-3-incrementos preserva evidencias anteriores como historico; a regra atual elimina a aprovacao obrigatoria e mantem privacidade/imutabilidade. Nenhum deploy de producao autorizado nesta tarefa.
