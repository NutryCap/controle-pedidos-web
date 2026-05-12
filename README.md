# Controle de Pedidos Web - Versão Final

Sistema web com painel simplificado por status:

- Status 1: Digitação
- Status 2: Separação / Pedido confirmado
- Status 4: Enviado completo
- Status 5: Enviado com corte
- Entregue: manual, marcado apenas por gerente de expedição ou admin

## 1. Configurar Supabase

1. Entre no Supabase.
2. Abra o projeto.
3. Vá em SQL Editor.
4. Execute o arquivo `supabase/schema.sql`.

## 2. Desativar confirmação de e-mail

Para sistema interno, recomendo desativar confirmação:

Authentication > Providers > Email > desligar Confirm email / Enable email confirmations.

## 3. Criar usuários

### Authentication > Users
Crie o login com e-mail e senha.

### Table Editor > usuarios
Cadastre o perfil usando o mesmo ID do usuário do Auth.

Exemplo representante:

| campo | valor |
|---|---|
| id | UID do usuário no Auth |
| nome | ADNAN |
| email | adnan@empresa.com |
| perfil | representante |
| representante_codigo | 00424-ADNAN |

O `representante_codigo` precisa bater exatamente com a coluna `REP.` da planilha.

Perfis válidos:

- representante
- supervisor
- admin
- assistente_vendas
- gerente_expedicao

## 4. Configurar .env.local

Na raiz do projeto, edite `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_ANON_PUBLIC
```

A URL e a chave precisam ser do mesmo projeto Supabase.

## 5. Rodar no computador

Abra o CMD na pasta do projeto e rode:

```bash
npm install
npm run dev
```

Acesse:

```text
http://localhost:3000
```

## 6. Publicar na Vercel

1. Suba este projeto para o GitHub.
2. Conecte na Vercel.
3. Em Environment Variables, configure as mesmas variáveis do `.env.local`.
4. Clique em Deploy.

## Permissões

- `assistente_vendas`: importa planilha.
- `gerente_expedicao`: marca pedido como entregue.
- `representante`: vê apenas pedidos com `REP.` igual ao `representante_codigo`.
- `supervisor`: vê todos.
- `admin`: vê todos, importa e marca entregue.
