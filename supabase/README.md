# Configuração do banco (Supabase)

## 1. Rodar o schema
No Supabase: **SQL Editor → New query**, cole o conteúdo de `schema.sql`, clique **Run**.

## 2. Rodar os dados iniciais do catálogo
Nova query, cole o conteúdo de `seed.sql`, **Run**.

## 3. Criar o primeiro usuário ADM
Os logins do sistema agora usam o login de verdade do Supabase (e-mail + senha
com criptografia), não mais senha em texto puro.

1. No Supabase: **Authentication → Users → Add user**
2. Preencha seu e-mail e uma senha, marque **Auto Confirm User**
3. Clique em **Create user**

Isso cria seu login, e o gatilho do banco já cria automaticamente seu perfil
com a função "Consultor". Agora precisa virar ADM — volte ao **SQL Editor** e rode:

```sql
update public.profiles set role = 'ADM' where email = 'SEU_EMAIL_AQUI';
```

Pronto — esse e-mail e senha (os que você definiu no passo 2) são o login do
sistema.

## 4. Criar os demais usuários da equipe
Repita o passo 3 (Authentication → Users → Add user) para cada consultor/funcionário.
Depois, na tela **Usuários** do sistema (logado como ADM), ajuste a função de
cada um (Gerente, Consultor, Influencer, MKT, Financeiro).

## Onde usar a Project URL e a anon key
Ficam em **Settings → API**. Essas duas informações vão dentro do arquivo
`config.js` do site (Claude configura isso para você).
