import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Esta rota é chamada 1x por dia por um agendador externo (cron-job.org).
// Ela verifica se alguma meta mensal foi criada nas últimas 24h e, se sim,
// envia um resumo para o e-mail de atendimento (administrador do sistema).

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DESTINATARIO = 'atendimentonutrycap@gmail.com';

// TODO: depois que o domínio nutrycap.com.br estiver verificado no Resend,
// trocar para algo como 'Nutry Cap <painel@nutrycap.com.br>'
const REMETENTE = 'onboarding@resend.dev';

function checarAutorizacao(request: Request) {
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(request: Request) {
  if (!checarAutorizacao(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const ontemNestaHora = new Date();
    ontemNestaHora.setHours(ontemNestaHora.getHours() - 24);

    const { data: metasRecentes, error } = await supabaseAdmin
      .from('metas_mensais')
      .select('ano, mes, meta_geral, criado_por_email, criado_em')
      .gte('criado_em', ontemNestaHora.toISOString())
      .order('criado_em', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!metasRecentes || metasRecentes.length === 0) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'Nenhuma atualização de meta nas últimas 24h.' });
    }

    const inicioDoDia = new Date();
    inicioDoDia.setHours(0, 0, 0, 0);

    const { data: jaEnviadoHoje } = await supabaseAdmin
      .from('metas_email_log')
      .select('id')
      .eq('tipo', 'resumo_atendimento')
      .gte('enviado_em', inicioDoDia.toISOString())
      .maybeSingle();

    if (jaEnviadoHoje) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'Resumo já enviado hoje.' });
    }

    const linhasResumo = metasRecentes
      .map((m) => {
        const nomeMes = new Date(m.ano, m.mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const valorFormatado = Number(m.meta_geral).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        return `<li>Meta de <b>${nomeMes}</b> definida por <b>${m.criado_por_email}</b>: ${valorFormatado}</li>`;
      })
      .join('');

    const resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: REMETENTE,
        to: [DESTINATARIO],
        subject: 'Resumo: atualização de meta de vendas',
        html: `
          <p>Olá,</p>
          <p>Houve atualização de meta de vendas nas últimas 24 horas:</p>
          <ul>${linhasResumo}</ul>
          <p><a href="https://controle-pedidos-web.vercel.app">Acessar o painel</a></p>
        `,
      }),
    });

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      return NextResponse.json({ ok: false, error: `Resend respondeu com erro: ${erroTexto}` }, { status: 500 });
    }

    await supabaseAdmin.from('metas_email_log').insert({
      tipo: 'resumo_atendimento',
      ano_referencia: metasRecentes[0].ano,
      mes_referencia: metasRecentes[0].mes,
      detalhes: { quantidade_metas: metasRecentes.length },
    });

    return NextResponse.json({ ok: true, enviado: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
}
