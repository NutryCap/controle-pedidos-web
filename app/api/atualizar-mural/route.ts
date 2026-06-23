import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Esta rota é chamada periodicamente por um agendador externo (ex: cron-job.org),
// não pelo navegador do usuário. Por isso usa a service_role key do Supabase,
// que tem permissão de escrita e nunca deve ser exposta no frontend.
//
// 100% gratuito: métricas vêm do próprio banco, a notícia vem do feed RSS
// público do Google News (sem chave de API), e a frase motivacional vem de
// uma lista fixa, sem repetir as últimas usadas.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function checarAutorizacao(request: Request) {
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${process.env.CRON_SECRET}`;
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

// Busca uma notícia real via Google News RSS — gratuito, sem chave de API.
// Se a busca falhar por qualquer motivo (bloqueio, instabilidade do feed, etc.),
// simplesmente não insere notícia neste ciclo, sem quebrar o resto do mural.
async function buscarNoticiaRelevante(): Promise<{ tipo: string; texto: string; fonte_url?: string } | null> {
  try {
    const query = encodeURIComponent('e-commerce OR varejo OR Shopee OR "Mercado Livre" when:3d');
    const url = `https://news.google.com/rss/search?q=${query}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;

    const resposta = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NutryCapPainel/1.0)' },
    });

    if (!resposta.ok) return null;

    const xml = await resposta.text();

    const primeiroItem = xml.split('<item>')[1];
    if (!primeiroItem) return null;

    const tituloMatch = primeiroItem.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = primeiroItem.match(/<link>([\s\S]*?)<\/link>/);

    if (!tituloMatch) return null;

    const titulo = tituloMatch[1].replace('<![CDATA[', '').replace(']]>', '').trim();

    if (!titulo) return null;

    return {
      tipo: 'noticia',
      texto: `📰 ${titulo}`,
      fonte_url: linkMatch ? linkMatch[1].trim() : undefined,
    };
  } catch {
    return null;
  }
}

const FRASES_MOTIVACIONAIS = [
  'Cada pedido entregue no prazo é a marca da nossa confiança chegando até o cliente.',
  'Hoje é um bom dia para superar a meta de ontem.',
  'Time alinhado, resultado garantido. Vamos juntos!',
  'Qualidade no atendimento é o que transforma um pedido em um cliente fiel.',
  'O sucesso de hoje é a soma de pequenas entregas bem feitas.',
  'Foco na excelência: cada detalhe importa para quem está do outro lado.',
  'Vender bem é cuidar bem — do início ao pós-venda.',
  'Energia boa gera resultado bom. Bora com tudo!',
  'A consistência vence a perfeição: continue entregando, todos os dias.',
  'Cliente satisfeito é a melhor propaganda que existe.',
  'Organização hoje é agilidade na entrega de amanhã.',
  'Pequenos progressos diários constroem grandes resultados mensais.',
  'Comunicação clara evita atraso e constrói confiança.',
  'Cada "sim" do cliente começa com um atendimento atencioso.',
  'Vamos transformar desafios de hoje em recordes de vendas este mês.',
  'O time que se ajuda, entrega mais rápido e melhor.',
  'Atenção aos detalhes é o que separa o bom do excelente.',
  'Disciplina na rotina garante tranquilidade no resultado.',
  'Toda meta começa com o primeiro pedido do dia.',
  'Seja a razão pela qual o cliente volta a comprar com a gente.',
  'Trabalho em equipe transforma metas grandes em conquistas possíveis.',
  'Cuidar do processo é cuidar do resultado final.',
  'Hoje é dia de fazer a diferença em cada pedido.',
  'Persistência é o ingrediente principal de toda meta batida.',
  'Boas vendas começam com bom humor e atenção total ao cliente.',
  'A expedição bem-feita é o último — e mais importante — passo da venda.',
  'Confiança se constrói entrega após entrega.',
  'Seja rápido na resposta e cuidadoso na entrega: essa é a fórmula.',
  'Vamos fazer deste mês o melhor até aqui!',
  'Resultado é consequência de hábito, não de sorte.',
  'O cliente sente quando o time se importa de verdade.',
  'Bora começar o dia com foco total na meta.',
  'Cada problema resolvido rápido é um cliente satisfeito a mais.',
  'A excelência está nos detalhes que ninguém vê, mas todos sentem.',
  'Time motivado entrega resultado motivador.',
  'Hoje pode ser o seu melhor dia de vendas do mês.',
  'Trabalhar bem em equipe é o atalho mais rápido para a meta.',
  'A pontualidade na entrega fala mais alto que qualquer promessa.',
  'Vamos com tudo: o cliente está esperando o nosso melhor.',
  'Cada conquista pequena de hoje é um passo para a grande meta do mês.',
];

function escolherFraseSemRepetirRecente(usadasRecentemente: string[]) {
  const disponiveis = FRASES_MOTIVACIONAIS.filter((f) => !usadasRecentemente.includes(f));
  const pool = disponiveis.length > 0 ? disponiveis : FRASES_MOTIVACIONAIS;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function gerarFraseMotivacional(): Promise<{ tipo: string; texto: string }> {
  const { data: recentes } = await supabaseAdmin
    .from('mural_painel')
    .select('texto')
    .eq('tipo', 'motivacional')
    .order('criado_em', { ascending: false })
    .limit(10);

  const textosRecentes = (recentes || []).map((r) => r.texto.replace('💪 ', ''));
  const frase = escolherFraseSemRepetirRecente(textosRecentes);

  return { tipo: 'motivacional', texto: `💪 ${frase}` };
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
