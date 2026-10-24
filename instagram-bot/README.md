# Bot de Direct do Instagram → CRM

Projeto independente do CRM. Tem o próprio `package.json` e vira um **segundo projeto na Vercel**, com Root Directory = `crm-vendas/instagram-bot`. O CRM estático não muda: o bot não toca em `script.js` nem no front.

## Como funciona

1. A pessoa manda mensagem no Direct e a Meta chama `POST /api/instagram`.
2. O bot confere a assinatura `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com `IG_APP_SECRET`) e responde 200 na hora. O resto roda em segundo plano (`waitUntil`).
3. Ignora eco (mensagem da própria conta) e `mid` já processado.
4. Grava a mensagem em `ig_conversations`. Depois do handoff, para aqui: só registra.
5. O Claude (`CLAUDE_MODEL`, padrão `claude-haiku-5-5`) devolve um JSON `{ reply, handoff, handoff_reason, lead{…} }`. Se vier algo fora do formato, recusa ou erro, nada do texto da IA vai para o lead: o bot faz handoff seguro com uma mensagem padrão.
6. Com nome + (WhatsApp ou e-mail), ou no handoff, chama `instagram_registrar_lead` (migração 081). Chama de novo a cada dado novo, porque a função é idempotente.
7. Responde pelo Graph API (até 1000 bytes, só dentro da janela de 24h).
8. No handoff: lead "Quente", resumo nas notas, conversa marcada como handoff e, se `HANDOFF_WEBHOOK_URL` existir, POST com `{ lead_id, consultor_nome, resumo }`.

O bot **não** escolhe consultor, não cria card e não grava histórico. Isso fica com os gatilhos que já existem no banco: rodízio (022/057), card do Pipeline (056), histórico (048) e bloqueio de telefone/e-mail repetido (033/005).

## Arquivos

| Arquivo | O que faz |
|---|---|
| `api/instagram.js` | Webhook: GET (verificação da Meta) e POST (mensagens) |
| `lib/conversa.js` | Fluxo de uma mensagem |
| `lib/ia.js` / `lib/prompt.js` | Chamada ao Claude e instruções da IA |
| `lib/supabase.js` | REST/RPC com a service_role (só `ig_conversations` e a função 081) |
| `lib/meta.js` | Assinatura, leitura do webhook, envio de mensagem |
| `lib/regras.js` | Regras puras: telefone, resumo, quando registrar |
| `test/` | Testes sem rede (`npm test`) |

## Antes de colocar no ar

1. Rodar `crm-vendas/supabase/migration_081_instagram_bot.sql` no SQL Editor do Supabase.
2. Na Meta: app com a API do Instagram (login do Instagram), conta profissional conectada e permissão de mensagens. Gere o token de acesso.
3. Na Vercel: novo projeto com o mesmo repositório, Root Directory `crm-vendas/instagram-bot`, e as variáveis de `.env.example`.
4. Na Meta, cadastre a URL `https://<projeto>.vercel.app/api/instagram` com o `IG_VERIFY_TOKEN` e assine o campo `messages`.
5. Teste com uma conta de teste antes de abrir ao público.

## Variáveis

Veja `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` e as chaves da Meta/Anthropic ficam só na Vercel.
