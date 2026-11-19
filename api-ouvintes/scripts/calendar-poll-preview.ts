import { readFile } from 'node:fs/promises';
import { previewCalendarPoll, type CalendarPollSource, type CalendarPollSchedule } from '../src/services/calendar-poll-parser.js';

// Developer-only fixture preview. Does not load env, app, database or Google SDK.
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/calendar-poll-sample.json', import.meta.url), 'utf8')) as {
  event: unknown; source: CalendarPollSource; schedule: CalendarPollSchedule;
};
const result = previewCalendarPoll(fixture.event, fixture.source, fixture.schedule);
const json = JSON.stringify(result, null, 2);
if (process.argv.includes('--html')) {
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const poll = result.kind === 'preview' ? result.poll : null;
  console.log(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plano 009 | Prévia da importação</title>
<style>:root{color-scheme:dark;font-family:Georgia,serif;background:#101114;color:#f4f4f5}*{box-sizing:border-box}body{margin:0;padding:clamp(20px,5vw,72px)}main{max-width:1100px;margin:auto}small,dt,aside{font-family:Verdana,sans-serif}small{color:#aaa;letter-spacing:.14em}h1{font-size:clamp(30px,4vw,48px);font-weight:500;margin:20px 0}header p{color:#aaa;font:15px/1.8 Verdana,sans-serif;max-width:750px}.status{display:inline-block;background:#183828;color:#a9ebc4;padding:9px 12px;border-radius:6px;font:13px Verdana,sans-serif}.columns{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}section{border-top:1px solid #393b41;padding-top:20px}h2{font-size:23px;font-weight:500}p{line-height:1.7;white-space:pre-wrap}dl{display:grid;grid-template-columns:1fr 1fr;gap:24px}dt{font-size:12px;color:#aaa;margin-bottom:8px}dd{margin:0;font-size:19px}.question{font-size:25px;line-height:1.35}aside{border-left:3px solid #338de7;margin-top:32px;padding:14px 20px;color:#c6d7ef;font-size:13px;line-height:1.8}pre{overflow:auto;font:12px/1.6 monospace;color:#b4bed1}summary{cursor:pointer;font:13px Verdana,sans-serif;margin-top:30px}@media(max-width:720px){.columns{grid-template-columns:1fr}dl{grid-template-columns:1fr 1fr}}</style>
<main><header><small>ECOSSISTEMA RÁDIO 88 FM · PLANO 009 · PARTE 1</small><h1>Do Agenda para a enquete.</h1><p>Demonstração do parser com um exemplo local. Não é a tela final do Gestão: nenhum evento foi consultado no Google, cadastrado ou publicado.</p><span class="status">${poll ? 'Conversão validada · revisão necessária' : 'Evento pendente'}</span></header>
<div class="columns"><section><small>ENTRADA · EXEMPLO NO AGENDA</small><h2>${escape((fixture.event as { summary: string }).summary)}</h2><p>${escape((fixture.event as { description: string }).description)}</p><aside>Evento de dia inteiro: 16/11/2026.<br>Programa da fixture: Bom Dia 88.<br>O programa padrão da agenda real ainda precisa ser confirmado.</aside></section>
<section><small>SAÍDA · PRÉVIA DO GESTÃO</small><h2 class="question">${escape(poll?.question ?? 'Requer conferência')}</h2><dl><div><dt>TIPO</dt><dd>${poll?.mode === 'message' ? 'Mensagem privada' : escape(poll?.mode ?? 'Pendente')}</dd></div><div><dt>IDENTIFICAÇÃO</dt><dd>Opcional</dd></div><div><dt>ABERTURA · BRASÍLIA</dt><dd>09h30</dd></div><div><dt>ENCERRAMENTO</dt><dd>12h00</dd></div><div><dt>ALTERNATIVAS</dt><dd>${poll?.options.length ?? 0} · sem inferência</dd></div><div><dt>PUBLICAÇÃO</dt><dd>Não realizada</dd></div></dl><aside>Sem alternativas explícitas, o ouvinte poderá enviar uma opinião. Nenhum voto Sim/Não foi inventado.<br>O cadastro manual continua independente.</aside></section></div><details><summary>Ver resultado técnico do parser</summary><pre>${escape(json)}</pre></details></main></html>`);
} else {
  console.log(json);
}
if (result.kind !== 'preview') process.exitCode = 1;
