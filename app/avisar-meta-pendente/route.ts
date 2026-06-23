import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Esta rota é chamada 1x por dia por um agendador externo (cron-job.org).
// Ela verifica se hoje é um dos 3 dias de aviso (26, 28, 30 ou 31 do mês) e,
// se a meta do PRÓXIMO mês ainda não existir, envia um e-mail de lembrete.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DESTINATARIOS = ['comercialnutrycap@gmail.com', 'Juliopachecomg2330@gmail.com'];

// TODO: depois que o domínio nutrycap.com.br estiver verificado no Resend,
// trocar para algo como 'Nutry Cap <painel@nutrycap.com.br>'
const REMETENTE = 'onboarding@resend.dev';

function checarAutorizacao(request: Request) {
  const auth = request.headers.get('authorization');
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

function ultimoDiaDoMes(ano: number, mesIndexZero: number) {
  return new Date(ano, mesIndexZero + 1, 0).getDate();
}

export async function GET(request: Request) {
  if (!checarAutorizacao(request)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const hoje = new Date();
    const dia = hoje.getDate();
    const ultimoDia = ultimoDiaDoMes(hoje.getFullYear(), hoje.getMonth());

    // Dias de aviso: 26, 28, e o último dia do mês (30 ou 31)
    const diasDeAviso = [26, 28, ultimoDia];
    if (!diasDeAviso.includes(dia)) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'Hoje não é um dia de aviso.' });
    }

    // O aviso é sobre a meta do mês QUE VEM
    const proximoMesData = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    const anoReferencia = proximoMesData.getFullYear();
    const mesReferencia = proximoMesData.getMonth() + 1;

    // Já existe meta definida para o próximo mês? Se sim, não precisa avisar.
    const { data: metaExistente } = await supabaseAdmin
      .from('metas_mensais')
      .select('id')
      .eq('ano', anoReferencia)
      .eq('mes', mesReferencia)
      .maybeSingle();

    if (metaExistente) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'Meta do próximo mês já foi definida.' });
    }

    // Evita duplicar o mesmo aviso se o cron rodar mais de uma vez no mesmo dia
    const inicioDoDia = new Date(hoje);
    inicioDoDia.setHours(0, 0, 0, 0);

    const { data: jaEnviadoHoje } = await supabaseAdmin
      .from('metas_email_log')
      .select('id')
      .eq('tipo', 'aviso_pendente')
      .eq('ano_referencia', anoReferencia)
      .eq('mes_referencia', mesReferencia)
      .gte('enviado_em', inicioDoDia.toISOString())
      .maybeSingle();

    if (jaEnviadoHoje) {
      return NextResponse.json({ ok: true, enviado: false, motivo: 'Aviso já enviado hoje.' });
    }

    const nomeMes = proximoMesData.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

    const resposta = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: REMETENTE,
        to: DESTINATARIOS,
        subject: `Defina a meta de vendas de ${nomeMes}`,
        html: `
          <p>Olá,</p>
          <p>A meta de vendas de <b>${nomeMes}</b> ainda não foi definida no painel de pedidos.</p>
          <p>Por favor, acesse o painel e defina a meta geral da empresa e as metas individuais por representante até o dia 5 do mês. Depois desse prazo, somente o administrador poderá fazer essa definição.</p>
          <p>Lembre-se: depois de salva, a meta não poderá mais ser editada.</p>
          <p><a href="https://controle-pedidos-web.vercel.app">Acessar o painel</a></p>
        `,
      }),
    });

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      return NextResponse.json({ ok: false, error: `Resend respondeu com erro: ${erroTexto}` }, { status: 500 });
    }

    await supabaseAdmin.from('metas_email_log').insert({
      tipo: 'aviso_pendente',
      ano_referencia: anoReferencia,
      mes_referencia: mesReferencia,
      detalhes: { dia_do_aviso: dia, destinatarios: DESTINATARIOS },
    });

    return NextResponse.json({ ok: true, enviado: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
}
