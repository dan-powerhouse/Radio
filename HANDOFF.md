# Para o próximo Claude

Leia isto antes de mexer no código. O código diz *o que* existe; esta nota diz *por que* existe assim e *para onde* vai. Escrita em 2026-11-25, depois do merge do servidor HTTP (PR #1, commit `0fcad07`).

---

## 1. A ideia, em uma frase

Uma tupla JSON livre roda sobre um processo JSON publicado, e a máquina devolve **um recibo assinado e mais nada**. Qualquer pessoa verifica esse recibo sem confiar em quem o emitiu: busca a tupla e o processo pelo hash e roda de novo.

O resto deriva disso:

- **O recibo é a carteira de identidade.** Cada recibo é a prova de que você passou por um processo. Por isso o usuário diz que "o recibo é seu documento".
- **Entrada livre, ativação conquistada.** Qualquer JSON é aceito e sempre registrado. O processo só roda quando a tupla cumpre as condições publicadas; senão o recibo sai `registered`, listando o que faltou. Traduzir texto em tupla é trabalho do tradutor (pessoa ou LLM), que precisa ler as regras. A máquina não interpreta nada.
- **Rádio.** Todo recibo vai ao ar na sua frequência, que é o processo que ele nomeia. Processos sintonizados reagem a outros recibos, e o workflow se monta sozinho. É coreografia, não orquestração.
- **CAS.** Tudo é endereçado pelo próprio hash: tupla, processo (a lei), recibo e detalhe. Mudar uma regra cria outra lei, com outro endereço.
- **Trajetórias.** Um recibo pode citar outro como entrada. Com isso, as lições de um curso formam uma cadeia que não pode bifurcar.

O usuário chegou a isso partindo de um trabalho sobre governança de agentes (PATT, LogLine). Ele pensa por metáforas fortes: gramática, contrato, rádio, carteira de identidade, visto. **Leve as metáforas a sério e teste-as.** Algumas viraram arquitetura: o rádio e o recibo como contrato. Outras precisaram de correção honesta: "a gramática substitui o control plane" não se sustentou nos experimentos, e eu disse isso a ele. O usuário prefere a verdade a ser agradado.

---

## 2. A história do servidor

### Onde estamos (verificado)

| Camada | Onde | Estado |
|---|---|---|
| Spec | `SPEC.md` | rascunho para congelar, com itens em aberto no §13 |
| Biblioteca | `src/` | TypeScript, zero dependências, só WebCrypto; roda igual em Node, Bun e browser |
| Máquina de referência | `src/ledger.ts` (`MemoryLedger`) | ledger em memória com rádio, coreografia, idempotência, consumo `once`, `sink` de persistência e `restore` |
| Servidor HTTP | `server/`, `bin/logline-server.mjs` | log JSONL encadeado por hash com fsync, rotas, rádio via SSE, contas por token |
| Testes | `test/` | 46/46 em Node e Bun, 57/57 vetores no Chromium (`npm test`) |
| Supabase | `supabase/migrations/0001_radio.sql` | rascunho antigo, **nunca aplicado** e já desatualizado |

O servidor em `server/` funciona e está bem testado: reinício, adulteração do log, corrida de pedidos, rádio retomável, autorização. Mas ele **guarda estado**: tudo vive na memória, há um único escritor com um mutex, e a cadeia de hash por linha serializa todas as escritas. Isso foi uma etapa. Não é o destino.

### Para onde vai: sem estado, com o Supabase como a única coisa viva

Duas ideias se juntaram:

**(a) O MCP 2026-07-28 tornou o protocolo sem estado.** Li o spec em modelcontextprotocol.io (changelog, versionamento, MRTR, `server/discover`, Streamable HTTP). As mudanças:

- Não há mais sessão nem handshake: cada pedido carrega versão, capacidades e identidade no `_meta`.
- Estado entre chamadas vira *handle* explícito, passado como argumento (SEP-2567).
- No lugar de o servidor perguntar ao cliente, ele responde `input_required`, e o cliente repete o pedido com tudo junto (MRTR, SEP-2322).
- Descoberta cacheável (`server/discover`), com `ttlMs`, `cacheScope` e listas em ordem determinística.
- Assinaturas por opt-in explícito (`subscriptions/listen`), sem retomada de stream.
- E um aviso: consumo único "MUST be enforced server-side".

A filosofia: **cada pedido carrega tudo de que precisa. O servidor só guarda o que precisa ser único. Qualquer instância atende qualquer pedido.**

O Radio já é quase isso, e num ponto é melhor:

- O recibo citado já é o "handle explícito".
- O `registered` com `unmet` já é o `input_required`.
- O `requestState` do MCP é um blob opaco que só o servidor verifica. O recibo é assinado e verificável por qualquer pessoa, e já amarra `by`, `when` e `input_hash`, justamente as proteções contra replay que o MCP recomenda.

**(b) O usuário propôs: o Supabase é a única coisa viva; o resto é reação em cadeia.**

```
agente/pessoa ──OAuth 2.1──▶ Supabase Auth (JWT + refresh)
      └─POST─▶ Edge Function submit   acorda, avalia com a biblioteca, assina, morre
                        ▼
              Postgres: o único processo vivo
                receipts   ← o INSERT é o evento
                objects    (CAS: tuplas, processos, detalhes)
                3 índices únicos: idempotência · consumo once · par (trigger, processo)
                outbox     ← trigger enfileira as reações
          ┌─────────────┼──────────────────┐
     Realtime (rádio)  pg_net / pgmq ──▶ Edge Function react
     filtra por freq,     │               acorda, emite o recibo da reação,
     status, by…          │               INSERT → dispara de novo
                     pg_cron: âncora periódica do topo do ledger
```

**Todo o estado se reduz a três chaves únicas:**

- a chave de idempotência (o `cacheKey` de hoje);
- `(processo, slot, recibo citado)` para o consumo `once`;
- `(trigger, processo)` para as reações.

No Postgres, isso são três índices únicos e um `INSERT … ON CONFLICT`. O mutex some. O resto (o `consumed`, o `idempotent` e o `reacted` do `MemoryLedger`) é recalculável.

**Ordem sugerida:**

1. Cachear o que é imutável. `/receipts/:id` e `/processes/:hash` levam `public, max-age=31536000, immutable`; detalhe e bundle, `private`. Hoje tudo sai `no-store`, o que está errado.
2. Separar a descoberta, que é estável (chaves, versões, limites), do `head`, que muda a cada escrita.
3. Versão por pedido: um cabeçalho `LogLine-Version`, e um erro que lista `supported` e `requested`.
4. Reescrever a migration com os três índices, a outbox e o RLS.
5. Escrever as functions `submit` e `react` com a biblioteca. Ela já roda em Deno.
6. Aceitar que o cliente traga o bundle das citações. A function verifica as assinaturas sem ler o banco e só confirma o consumo no índice único.
7. Trocar a cadeia de hash por linha por uma âncora Merkle periódica sobre faixas de `seq`, emitida como recibo em `logline.anchor`. **Discuta com o usuário antes.**

**Decisões que são do usuário, não suas:**

- Hoje o `submit` devolve as reações na mesma resposta. Numa cadeia assíncrona, ele devolve só o recibo raiz, e as reações chegam pelo rádio. Essa troca muda a API.
- Qual projeto Supabase usar. Esta sessão não tinha acesso a nenhum.

**O `server/` não deve ser apagado.** Ele continua como máquina de referência local, para desenvolver sem nuvem. `test/server.test.mjs` é o contrato que a versão Supabase precisa cumprir (menos a parte síncrona das reações, se ela mudar).

---

## 3. Auth

**O que existe hoje:** tokens `llt_…` em `data/accounts.json`. Só o hash SHA-256 do token é guardado, e o arquivo é relido quando muda. Uma conta tem nome e um indicador de admin. Isso foi o mínimo honesto para o servidor local, e **deve ser substituído pelo Supabase Auth**.

**Por que o Supabase Auth:**

- Ele fala OAuth 2.1, com tokens de curta duração e refresh.
- A autorização do MCP também é OAuth 2.1. Um agente MCP se autentica no Radio do mesmo jeito que em qualquer servidor MCP, e o `submit` pode ser exposto como uma tool. Isso coloca o Radio no mesmo idioma dos agentes, que era a tese original do usuário.

**Princípios que não mudam com a troca:**

- **A conta nunca vai ao ar.** No ar, `by = "p:" + hex(HMAC-SHA256(segredo_da_implantação, auth.uid()))` (`pseudonym()` em `src/radio.ts`). A pessoa encontra os próprios recibos com `by=me`; ninguém sem o segredo liga pseudônimo a conta.
- **A máquina atesta quem submeteu.** O `by` é escrito pela máquina a partir do token, nunca lido da tupla. Na tupla, `who` é só texto livre.
- **O privado é privado por padrão.** Só o cabeçalho assinado vai ao ar. Tupla e detalhe saem apenas para o dono (pseudônimo igual) ou para um admin, o que no Supabase vira RLS. Hoje uma submissão anônima recebe o detalhe só na resposta e em nenhum outro lugar.
- **Publicar uma lei é ato de admin.** Uma lei publicada não muda; emenda-se com um id novo.

**Escreva na página de garantias:** quem controla o projeto Supabase controla a chave da máquina e pode assinar recibos. Isso já era verdade no servidor próprio. Por isso a rotação de chaves como recibo (§11 do spec) ganha importância. Chaves de usuário, como passkeys, ficam para a v2.

**Não verificado por mim, confira antes de prometer:**

- os detalhes do servidor OAuth 2.1 do Supabase Auth;
- os limites de CPU e tempo das Edge Functions;
- se o plano do projeto pausa por inatividade. Pelo que sei, o plano grátis pausa depois de uma semana, o que derruba a "única coisa viva".

---

## 4. Por que a elegância importa aqui

Neste projeto a elegância não é estética. **É a garantia.** O valor do Radio está em alguém de fora conseguir verificar tudo sem confiar em ninguém, e isso só é possível se o sistema for pequeno o bastante para caber numa cabeça e numa especificação. Cada caso especial é um lugar onde duas implementações vão discordar, e uma discordância é uma falha de segurança (o argumento LangSec: *parse, don't validate*).

Princípios que guiaram o trabalho. Mantenha-os:

1. **Tudo é um hash, uma assinatura ou uma função pura.** Só a tradução de linguagem em tupla é probabilística, e ela fica fora do núcleo. Se você adicionar algo que não é nenhum desses três, pare e pergunte por quê.
2. **Um formato só.** Submissão, decisão, recusa, registro, reação, rotação de chave e âncora: tudo é recibo. Não crie um segundo tipo de mensagem.
3. **Um avaliador só.** O mesmo código TypeScript roda no servidor, no browser, na CLI e nas Edge Functions. Não reimplemente regras em SQL nem em outra linguagem: a verificação depende de existir uma única semântica.
4. **Subtrair antes de somar.** O MCP 2026-07-28 ficou melhor *removendo*: sessão, handshake, ping, retomada. Este trabalho também. A migração para o Supabase deve apagar código (mutex, contas, reconstrução em memória), não acumular.
5. **Estado só onde a unicidade exige.** Três índices únicos. Todo o resto se deriva, e derivado nunca se armazena como verdade: o `restore` recalcula em vez de confiar.
6. **Toda recusa explica a si mesma.** Recibos não-`ok` dizem o que faltou e como corrigir. Erros HTTP têm código estável e motivo. O usuário pensa nisso como **dignidade**: o sistema trata quem submete como alguém que merece saber por quê.
7. **Honestidade sobre o que é garantido.** O README tem uma seção "What the server guarantees" e uma linha "Not yet". Um recibo prova quem submeteu, sob qual lei, com qual resultado, sem alteração. Ele **não** prova que os fatos são verdadeiros. Nunca exagere isso.
8. **O spec vem antes do código.** Mudou o formato? Atualize o `SPEC.md`, regenere os vetores (`npm run vectors`) e diga ao usuário que foi uma mudança incompatível. Isso ainda é permitido porque o spec não foi congelado.
9. **Pequeno de propósito.** A biblioteca e o servidor somam cerca de 1.340 linhas, sem dependências. O pedido do usuário foi literalmente: "não enterprise, mas algo real, com dignidade". Nada de HSM, multi-região, SSO ou blockchain na v1.
10. **Nomes são parte do design.** Frequência, sintonia, recibo, trajetória, `registered`. O vocabulário do usuário virou o vocabulário do código. Preserve-o: é ele que faz o sistema ser explicável.

---

## 5. Como trabalhar com este usuário

- Ele escreve em português; o código, o spec e o README estão em inglês.
- Gosta de ver o raciocínio virar algo que roda. Demos no browser e testes passando convencem mais que texto.
- Antes de publicar, fazer merge ou mexer em infraestrutura, confirme. Ele diz "send" e "merge" quando quer.
- Ao terminar, rode `npm test` e diga os números exatos. Se algo falhou ou ficou de fora, diga.
