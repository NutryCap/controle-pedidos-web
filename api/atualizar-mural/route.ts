import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Esta rota é chamada periodicamente por um agendador externo (ex: cron-job.org),
// não pelo navegador do usuário. Por isso usa a service_role key do Supabase,
// que tem permissão de escrita e nunca deve ser exposta no frontend.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function checarAutorizacao(request: Request) {
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

async function gerarComClaude(prompt: string): Promise<string> {
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!resposta.ok) {
    throw new Error(`Erro ao chamar a API da Anthropic: ${resposta.status}`);
  }

  const dados = await resposta.json();
  const texto = dados.content?.find((c: any) => c.type === 'text')?.text;
  return (texto || '').trim();
}

async function buscarMetricasInternas() {
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);
  const isoSeteDias = seteDiasAtras.toISOString().slice(0, 10);
  const isoHoje = hoje.toISOString().slice(0, 10);

  const { data: pedidosSemana, error } = await supabaseAdmin
    .from('pedidos')
    .select('entregue, situacao_prazo, entrada')
    .gte('entrada', isoSeteDias)
    .lte('entrada', isoHoje);

  if (error || !pedidosSemana) return [];

  const totalSemana = pedidosSemana.length;
  const entreguesSemana = pedidosSemana.filter((p) => p.entregue).length;
  const noPrazoSemana = pedidosSemana.filter((p) => p.situacao_prazo !== 'atrasado').length;

  const itens: { tipo: string; texto: string }[] = [];

  if (totalSemana > 0) {
    const percentualPrazo = Math.round((noPrazoSemana / totalSemana) * 100);
    itens.push({
      tipo: 'metrica',
      texto: `📦 Nos últimos 7 dias: ${totalSemana} pedidos registrados, ${entreguesSemana} já entregues, ${percentualPrazo}% dentro do prazo.`,
    });
  }

  return itens;
}

async function buscarNoticiaRelevante(): Promise<{ tipo: string; texto: string; fonte_url?: string } | null> {
  try {
    const resposta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content:
              'Busque uma notícia real e recente (dos últimos dias) sobre e-commerce, marketplaces ou varejo no Brasil que possa impactar vendas de uma loja de cosméticos capilares (ex: mudanças na Shopee/Mercado Livre, frete, datas sazonais de venda, comportamento do consumidor). Depois de buscar, responda em português, em no máximo 2 frases curtas, direto ao ponto, sem introduções. Se a busca não retornar nada relevante, responda apenas: SEM_NOTICIA',
          },
        ],
      }),
    });

    if (!resposta.ok) return null;

    const dados = await resposta.json();
    const blocoTexto = dados.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ').trim();

    if (!blocoTexto || blocoTexto.includes('SEM_NOTICIA')) return null;

    return { tipo: 'noticia', texto: `📰 ${blocoTexto}` };
  } catch {
    return null;
  }
}

async function gerarFraseMotivacional(): Promise<{ tipo: string; texto: string }> {
  const prompt = `Crie uma frase motivacional curta (máximo 18 palavras), original, em português do Brasil, voltada para uma equipe de vendas e expedição de uma empresa de cosméticos capilares. Tom energético mas profissional, sem clichê excessivo. Responda apenas com a frase, sem aspas, sem explicações.`;

  const texto = await gerarComClaude(prompt);

  return { tipo: 'motivacional', texto: `💪 ${texto}` };
}

export async function GET(request: Request) {
  if (!checarAutorizacao(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const novosItens: { tipo: string; texto: string; fonte_url?: string }[] = [];

    novosItens.push(...(await buscarMetricasInternas()));

    const noticia = await buscarNoticiaRelevante();
    if (noticia) novosItens.push(noticia);

    novosItens.push(await gerarFraseMotivacional());

    if (novosItens.length === 0) {
      return NextResponse.json({ ok: true, inseridos: 0, aviso: 'Nenhum item novo gerado.' });
    }

    const { error: erroInsercao } = await supabaseAdmin.from('mural_painel').insert(novosItens);

    if (erroInsercao) {
      return NextResponse.json({ ok: false, error: erroInsercao.message }, { status: 500 });
    }

    // Desativa itens com mais de 48h para o mural não crescer indefinidamente
    const limite = new Date();
    limite.setHours(limite.getHours() - 48);
    await supabaseAdmin
      .from('mural_painel')
      .update({ ativo: false })
      .lt('criado_em', limite.toISOString())
      .eq('ativo', true);

    return NextResponse.json({ ok: true, inseridos: novosItens.length });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
}
