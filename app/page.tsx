'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { calcularPrazo, formatarData, parseDataBrasil } from '@/lib/prazos';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  LogOut,
  PackageSearch,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';

type Perfil =
  | 'representante'
  | 'assistente_vendas'
  | 'gerente_expedicao'
  | 'supervisor'
  | 'admin';

type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  representante_codigo?: string | null;
};

type Pedido = {
  seq: string;
  cliente: string | null;
  representante: string | null;
  status: number | null;
  status_texto: string | null;
  entrada: string | null;
  total: number | null;
  observacao: string | null;
  entregue: boolean;
  prazo_final: string | null;
  dias_uteis_restantes: number | null;
  situacao_prazo: string | null;
  mensagem_prazo: string | null;
};

type RelatorioImportacao = {
  linhasLidas: number;
  validas: number;
  ignoradas: number;
  semData: number;
  semRepresentante: number;
  statusCorrigido: number;
  duplicados: number;
  exemplosIgnorados: string[];
};

const COLUNAS = [
  { id: 'digitacao', titulo: 'Digitação', status: 1 },
  { id: 'separacao', titulo: 'Separação / Pedido confirmado', status: 2 },
  { id: 'enviado_completo', titulo: 'Enviado completo', status: 4 },
  { id: 'enviado_corte', titulo: 'Enviado com corte', status: 5 },
  { id: 'entregue', titulo: 'Entregue', status: null },
];

function statusTexto(status: any) {
  const s = Number(status);
  if (s === 1) return 'Digitação';
  if (s === 2) return 'Separação / Pedido confirmado';
  if (s === 4) return 'Enviado completo';
  if (s === 5) return 'Enviado com corte';
  return status ? `Status ${status}` : 'Sem status';
}

function normalizarTexto(valor: any) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function valorCampo(row: any, nomes: string[]) {
  const keys = Object.keys(row);
  for (const nome of nomes) {
    const achou = keys.find((k) => normalizarTexto(k) === normalizarTexto(nome));
    if (achou) return row[achou];
  }
  return null;
}

function dataIso(date: Date | null) {
  if (!date || isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function linhasParaObjetos(sheet: XLSX.WorkSheet) {
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];

  const linhaCabecalhoIndex = matriz.findIndex((linha) =>
    linha.some((celula) => normalizarTexto(celula) === 'seq.')
  );

  if (linhaCabecalhoIndex === -1) {
    return { rows: [], erro: 'Não encontrei a coluna SEQ. na planilha.' };
  }

  const cabecalhos = matriz[linhaCabecalhoIndex].map((h) => String(h || '').trim());
  const dados = matriz.slice(linhaCabecalhoIndex + 1);

  const rows = dados
    .filter((linha) => linha.some((celula) => celula !== null && celula !== undefined && celula !== ''))
    .map((linha) => {
      const obj: any = {};
      cabecalhos.forEach((cabecalho, index) => {
        if (cabecalho) obj[cabecalho] = linha[index];
      });
      return obj;
    });

  return { rows, erro: null };
}

function explicarErroSupabase(error: any) {
  const msg = String(error?.message || error || '');

  if (msg.includes('Invalid API key')) {
    return 'Chave API inválida. Confira se NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são do mesmo projeto no arquivo .env.local.';
  }
  if (msg.includes('Email not confirmed')) {
    return 'E-mail não confirmado. No Supabase, desative confirmação de e-mail em Authentication > Providers > Email ou confirme manualmente o usuário.';
  }
  if (msg.includes('ON CONFLICT DO UPDATE command cannot affect row a second time')) {
    return 'A planilha possui pedidos duplicados com o mesmo SEQ. dentro do mesmo arquivo.';
  }
  if (msg.includes('dias_uteis_restantes')) {
    return 'A tabela pedidos no Supabase não possui a coluna dias_uteis_restantes. Execute o schema.sql atualizado no SQL Editor.';
  }
  if (msg.includes('status') && msg.includes('not-null')) {
    return 'Alguma linha veio sem status, mas a coluna status do banco não aceita vazio. Execute o schema.sql atualizado.';
  }
  if (msg.includes('invalid input syntax for type date')) {
    return 'Alguma data veio inválida da planilha. O sistema tentou tratar, mas o banco recebeu uma data inválida.';
  }
  if (msg.includes('permission denied') || msg.includes('row-level security')) {
    return 'Permissão negada pelo Supabase. Confira se o usuário está cadastrado na tabela usuarios com o perfil correto.';
  }

  return msg || 'Erro desconhecido ao comunicar com o Supabase.';
}

export default function Home() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [entrando, setEntrando] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const [mensagem, setMensagem] = useState('');
  const [tipoMensagem, setTipoMensagem] = useState<'ok' | 'erro' | 'info'>('info');
  const [importando, setImportando] = useState(false);
  const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);

  async function carregarUsuario() {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) {
      setUsuario(null);
      setCarregando(false);
      return;
    }

    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', auth.user.id)
      .single();

    if (error || !data) {
      setMensagem('Login existe no Auth, mas ainda não foi cadastrado na tabela usuarios. Cadastre o perfil no Supabase.');
      setTipoMensagem('erro');
      setUsuario(null);
      setCarregando(false);
      return;
    }

    setUsuario(data as Usuario);
    setCarregando(false);
  }

  async function carregarPedidos() {
    if (!usuario) return;
    setAtualizando(true);

    let query = supabase.from('pedidos').select('*').order('entrada', { ascending: false });

    if (usuario.perfil === 'representante') {
      query = query.eq('representante', usuario.representante_codigo || '');
    }

    const { data, error } = await query;

    if (error) {
      setMensagem(explicarErroSupabase(error));
      setTipoMensagem('erro');
      setAtualizando(false);
      return;
    }

    setPedidos((data || []) as Pedido[]);
    setAtualizando(false);
  }

  useEffect(() => {
    carregarUsuario();
    const { data: sub } = supabase.auth.onAuthStateChange(() => carregarUsuario());
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (usuario) carregarPedidos();
  }, [usuario]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setMensagem('');
    setTipoMensagem('info');
    setEntrando(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      setMensagem(explicarErroSupabase(error));
      setTipoMensagem('erro');
    }
    setEntrando(false);
  }

  async function sair() {
    await supabase.auth.signOut();
    setUsuario(null);
    setPedidos([]);
  }

  const podeImportar = usuario?.perfil === 'assistente_vendas' || usuario?.perfil === 'admin';
  const podeEntregar = usuario?.perfil === 'gerente_expedicao' || usuario?.perfil === 'admin';

  async function importarPlanilha(file: File) {
    if (!podeImportar) {
      setMensagem('Seu perfil não tem permissão para importar planilha. Somente assistente de vendas ou admin podem importar.');
      setTipoMensagem('erro');
      return;
    }

    try {
      setImportando(true);
      setMensagem('Importando planilha...');
      setTipoMensagem('info');
      setRelatorio(null);

      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];

      const resultado = linhasParaObjetos(sheet);

      if (resultado.erro) {
        setMensagem(resultado.erro);
        setTipoMensagem('erro');
        return;
      }

      const rows = resultado.rows;
      let ignoradas = 0;
      let semData = 0;
      let semRepresentante = 0;
      let statusCorrigido = 0;
      const exemplosIgnorados: string[] = [];

      const payloadBruto = rows
        .map((row: any, index: number) => {
          const linhaPlanilha = index + 1;
          const seq = String(valorCampo(row, ['SEQ.', 'SEQ', 'Pedido', 'ID', 'Número', 'Numero']) || '').trim();

          if (!seq) {
            ignoradas++;
            if (exemplosIgnorados.length < 5) exemplosIgnorados.push(`Linha ${linhaPlanilha}: sem SEQ.`);
            return null;
          }

          const entradaBruta = valorCampo(row, ['ENTRADA', 'DIGITAÇÃO', 'DIGITACAO', 'DATA', 'DATA ENTRADA']);
          const entradaDate = parseDataBrasil(entradaBruta);
          if (!entradaDate) semData++;

          const prazo = calcularPrazo(entradaDate, 7);

          const statusBruto = valorCampo(row, ['S', 'STATUS', 'Status']);
          let statusTratado = Number(statusBruto);
          if (statusBruto === null || statusBruto === undefined || statusBruto === '' || isNaN(statusTratado)) {
            statusTratado = 1;
            statusCorrigido++;
          }

          const representante = String(valorCampo(row, ['REP.', 'REP', 'REPRESENTANTE', 'Representante']) || '').trim();
          if (!representante) semRepresentante++;

          const totalBruto = valorCampo(row, ['TOTAL', 'Total', 'VALOR']);
          const totalTratado = Number(String(totalBruto || '0').replace(/\./g, '').replace(',', '.')) || null;

          return {
            seq,
            cliente: String(valorCampo(row, ['CLIENTE', 'Cliente']) || '').trim() || null,
            representante: representante || null,
            status: statusTratado,
            status_texto: statusTexto(statusTratado),
            entrada: dataIso(entradaDate),
            total: totalTratado,
            observacao: String(valorCampo(row, ['OBS', 'OBS.', 'Observação', 'OBSERVACAO']) || '').trim() || null,
            prazo_final: dataIso(prazo.prazoFinal),
            dias_uteis_restantes: prazo.diasUteisRestantes,
            situacao_prazo: prazo.situacaoPrazo,
            mensagem_prazo: prazo.mensagem,
            atualizado_em: new Date().toISOString(),
          };
        })
        .filter(Boolean) as any[];

      if (!payloadBruto.length) {
        setMensagem('Nenhum pedido válido encontrado. O sistema encontrou a coluna SEQ., mas nenhuma linha válida foi importada.');
        setTipoMensagem('erro');
        setRelatorio({ linhasLidas: rows.length, validas: 0, ignoradas, semData, semRepresentante, statusCorrigido, duplicados: 0, exemplosIgnorados });
        return;
      }

      const pedidosMap = new Map<string, any>();
      payloadBruto.forEach((pedido) => pedidosMap.set(pedido.seq, pedido));
      const payloadFinal = Array.from(pedidosMap.values());
      const duplicados = payloadBruto.length - payloadFinal.length;

      const { error } = await supabase.from('pedidos').upsert(payloadFinal, { onConflict: 'seq' });

      setRelatorio({ linhasLidas: rows.length, validas: payloadFinal.length, ignoradas, semData, semRepresentante, statusCorrigido, duplicados, exemplosIgnorados });

      if (error) {
        setMensagem(explicarErroSupabase(error));
        setTipoMensagem('erro');
        return;
      }

      setMensagem(`${payloadFinal.length} pedidos importados/atualizados com sucesso. ${duplicados} duplicados foram consolidados automaticamente.`);
      setTipoMensagem('ok');
      await carregarPedidos();
    } catch (error: any) {
      setMensagem(`Erro inesperado na importação: ${error?.message || String(error)}`);
      setTipoMensagem('erro');
    } finally {
      setImportando(false);
    }
  }

  async function marcarEntregue(seq: string) {
    if (!podeEntregar || !usuario) {
      setMensagem('Seu perfil não tem permissão para marcar pedido como entregue. Somente gerente de expedição ou admin podem fazer isso.');
      setTipoMensagem('erro');
      return;
    }

    const { error } = await supabase
      .from('pedidos')
      .update({ entregue: true, entregue_em: new Date().toISOString(), entregue_por: usuario.id, atualizado_em: new Date().toISOString() })
      .eq('seq', seq);

    if (error) {
      setMensagem(explicarErroSupabase(error));
      setTipoMensagem('erro');
      return;
    }

    setMensagem(`Pedido ${seq} marcado como entregue.`);
    setTipoMensagem('ok');
    await carregarPedidos();
  }

  const pedidosFiltrados = useMemo(() => {
    const q = busca.toLowerCase().trim();
    return pedidos.filter((p) => {
      if (!q) return true;
      return [p.seq, p.cliente, p.representante, p.status_texto, p.situacao_prazo, p.mensagem_prazo].some((v) =>
        String(v || '').toLowerCase().includes(q)
      );
    });
  }, [pedidos, busca]);

  const grupos = useMemo(() => ({
    digitacao: pedidosFiltrados.filter((p) => !p.entregue && Number(p.status) === 1),
    separacao: pedidosFiltrados.filter((p) => !p.entregue && Number(p.status) === 2),
    enviado_completo: pedidosFiltrados.filter((p) => !p.entregue && Number(p.status) === 4),
    enviado_corte: pedidosFiltrados.filter((p) => !p.entregue && Number(p.status) === 5),
    entregue: pedidosFiltrados.filter((p) => p.entregue),
  }), [pedidosFiltrados]);

  const totais = useMemo(() => ({
    total: pedidosFiltrados.length,
    atrasados: pedidosFiltrados.filter((p) => p.situacao_prazo === 'atrasado' && !p.entregue).length,
    proximos: pedidosFiltrados.filter((p) => p.situacao_prazo === 'proximo' && !p.entregue).length,
    entregues: pedidosFiltrados.filter((p) => p.entregue).length,
  }), [pedidosFiltrados]);

  if (carregando) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: 'var(--paper)' }}>
        <div className="flex items-center gap-3" style={{ color: 'var(--ink-soft)' }}>
          <RefreshCw className="animate-spin" size={20} />
          <span className="font-mono text-sm">carregando painel…</span>
        </div>
      </main>
    );
  }

  if (!usuario) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--paper)' }}>
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div
              className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-3"
              style={{ background: 'var(--stamp)' }}
            >
              <PackageSearch className="text-white" size={26} />
            </div>
            <h1 className="font-display text-3xl" style={{ color: 'var(--ink)' }}>
              Controle de Pedidos
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-soft)' }}>
              Nutry Cap · acompanhamento por status
            </p>
          </div>

          <form
            onSubmit={login}
            className="rounded-2xl p-7 space-y-4"
            style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)', boxShadow: '0 1px 2px rgba(31,42,36,0.06)' }}
          >
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
                  E-mail
                </label>
                <input
                  className="w-full mt-1 rounded-lg px-4 py-3 text-[15px] bg-transparent"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
                  placeholder="seu.email@nutrycap.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
                  Senha
                </label>
                <input
                  className="w-full mt-1 rounded-lg px-4 py-3 text-[15px] bg-transparent"
                  style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
                  placeholder="••••••••"
                  type="password"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                />
              </div>
            </div>

            <button
              disabled={entrando}
              className="w-full rounded-lg py-3 font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-60"
              style={{ background: 'var(--stamp)' }}
            >
              {entrando ? <RefreshCw className="animate-spin" size={18} /> : null}
              {entrando ? 'Entrando…' : 'Entrar'}
            </button>

            {mensagem && (
              <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'var(--alert-soft)', color: 'var(--alert)' }}>
                {mensagem}
              </p>
            )}
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-4 md:p-6" style={{ background: 'var(--paper)' }}>
      <div className="max-w-[1800px] mx-auto space-y-4">
        <header
          className="rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
          style={{ background: 'var(--stamp)' }}
        >
          <div>
            <p className="font-display text-xs tracking-widest" style={{ color: '#cdd9ec' }}>
              Nutry Cap · expedição
            </p>
            <h1 className="font-display text-3xl md:text-4xl text-white leading-tight">
              Painel de Pedidos
            </h1>
            <p className="text-sm mt-1" style={{ color: '#cdd9ec' }}>
              {usuario.nome} · {usuario.perfil.replace('_', ' ')}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={carregarPedidos}
              disabled={atualizando}
              className="px-4 py-2 rounded-lg text-white flex items-center gap-2 font-medium disabled:opacity-60"
              style={{ background: 'var(--stamp-dark)' }}
            >
              <RefreshCw size={18} className={atualizando ? 'animate-spin' : ''} />
              {atualizando ? 'Atualizando…' : 'Atualizar'}
            </button>
            <button
              onClick={sair}
              className="px-4 py-2 rounded-lg flex items-center gap-2 font-medium"
              style={{ background: 'var(--paper-raised)', color: 'var(--ink)' }}
            >
              <LogOut size={18} /> Sair
            </button>
          </div>
        </header>

        {mensagem && (
          <div
            className="rounded-xl p-4 flex gap-3 items-start"
            style={
              tipoMensagem === 'erro'
                ? { background: 'var(--alert-soft)', borderLeft: '4px solid var(--alert)', color: 'var(--alert)' }
                : tipoMensagem === 'ok'
                ? { background: 'var(--ok-soft)', borderLeft: '4px solid var(--ok)', color: 'var(--ok)' }
                : { background: 'var(--paper-raised)', borderLeft: '4px solid var(--stamp)', color: 'var(--ink)' }
            }
          >
            {tipoMensagem === 'erro' ? <AlertTriangle size={20} /> : <FileText size={20} />}
            <div className="text-sm">{mensagem}</div>
          </div>
        )}

        {relatorio && (
          <section className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)' }}>
            <div className="flex items-center gap-2 font-display text-sm tracking-wide" style={{ color: 'var(--ink)' }}>
              <FileText size={16} /> Relatório da importação
            </div>
            <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
              <MiniCard label="Linhas lidas" value={relatorio.linhasLidas} />
              <MiniCard label="Válidas" value={relatorio.validas} />
              <MiniCard label="Ignoradas" value={relatorio.ignoradas} />
              <MiniCard label="Sem data" value={relatorio.semData} />
              <MiniCard label="Sem representante" value={relatorio.semRepresentante} />
              <MiniCard label="Status corrigido" value={relatorio.statusCorrigido} />
              <MiniCard label="Duplicados" value={relatorio.duplicados} />
            </div>
            {relatorio.exemplosIgnorados.length > 0 && (
              <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
                Exemplos ignorados: {relatorio.exemplosIgnorados.join(' | ')}
              </p>
            )}
          </section>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card label="Total" value={totais.total} />
          <Card label="Atrasados" value={totais.atrasados} color="var(--alert)" />
          <Card label="Prazo ≤ 2 dias" value={totais.proximos} color="var(--warn)" />
          <Card label="Entregues" value={totais.entregues} color="var(--ok)" />
        </section>

        <section
          className="rounded-2xl p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between"
          style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)' }}
        >
          <div className="relative w-full md:max-w-md">
            <Search className="absolute left-3 top-3" style={{ color: 'var(--ink-soft)' }} size={20} />
            <input
              className="w-full rounded-lg pl-10 pr-4 py-3 bg-transparent"
              style={{ border: '1px solid var(--line)', color: 'var(--ink)' }}
              placeholder="Buscar pedido, cliente, representante ou prazo"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          {podeImportar && (
            <label
              className="cursor-pointer rounded-lg px-4 py-3 font-semibold flex items-center gap-2 justify-center text-white"
              style={importando ? { background: '#9a9482', pointerEvents: 'none' } : { background: 'var(--stamp)' }}
            >
              {importando ? <RefreshCw className="animate-spin" size={18} /> : <Upload size={18} />}
              {importando ? 'Importando...' : 'Importar planilha'}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" disabled={importando} onChange={(e) => e.target.files?.[0] && importarPlanilha(e.target.files[0])} />
            </label>
          )}
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 items-start">
          {COLUNAS.map((coluna) => {
            const lista = grupos[coluna.id as keyof typeof grupos];
            return (
              <div key={coluna.id} className="rounded-2xl p-3 min-h-[300px]" style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)' }}>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h2 className="font-display text-sm tracking-wide" style={{ color: 'var(--ink)' }}>
                    {coluna.titulo}
                  </h2>
                  <span
                    className="text-xs font-mono px-2.5 py-1 rounded-full font-semibold"
                    style={{ background: 'var(--paper)', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}
                  >
                    {lista.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {lista.map((p) => <PedidoCard key={p.seq} pedido={p} podeEntregar={podeEntregar} marcarEntregue={marcarEntregue} />)}
                  {!lista.length && (
                    <div
                      className="text-center text-sm rounded-xl p-4"
                      style={{ color: 'var(--ink-soft)', border: '1px dashed var(--line)' }}
                    >
                      Nenhum pedido
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function PedidoCard({ pedido, podeEntregar, marcarEntregue }: { pedido: Pedido; podeEntregar: boolean; marcarEntregue: (seq: string) => void }) {
  const atrasado = pedido.situacao_prazo === 'atrasado' && !pedido.entregue;
  const proximo = pedido.situacao_prazo === 'proximo' && !pedido.entregue;

  const acento = atrasado ? 'var(--alert)' : proximo ? 'var(--warn)' : pedido.entregue ? 'var(--ok)' : 'var(--line)';

  return (
    <article
      className="ticket-edge rounded-xl pl-4 pr-3 py-3 space-y-3"
      style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderLeft: `4px solid ${acento}` }}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono font-semibold text-[15px]" style={{ color: 'var(--ink)' }}>
            #{pedido.seq}
          </h3>
          {atrasado && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: 'var(--alert)', color: 'white' }}>Atrasado</span>}
          {proximo && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: 'var(--warn)', color: 'white' }}>Próximo</span>}
          {pedido.entregue && <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ background: 'var(--ok)', color: 'white' }}>Entregue</span>}
        </div>
        <p className="text-sm font-medium line-clamp-2" style={{ color: 'var(--ink)' }}>{pedido.cliente || 'Cliente não informado'}</p>
        <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>Rep.: {pedido.representante || '-'}</p>
      </div>
      <div className="text-xs space-y-1" style={{ color: 'var(--ink-soft)' }}>
        <p>Entrada: <b style={{ color: 'var(--ink)' }}>{formatarData(pedido.entrada)}</b></p>
        <p>Prazo: <b style={{ color: 'var(--ink)' }}>{formatarData(pedido.prazo_final)}</b></p>
        <p>{pedido.mensagem_prazo || '-'}</p>
      </div>
      {pedido.observacao && (
        <p className="text-xs pt-2" style={{ color: 'var(--ink-soft)', borderTop: '1px solid var(--line)' }}>
          Obs: {pedido.observacao}
        </p>
      )}
      {podeEntregar && !pedido.entregue && (
        <button
          onClick={() => marcarEntregue(pedido.seq)}
          className="w-full px-3 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 text-white"
          style={{ background: 'var(--ok)' }}
        >
          <CheckCircle2 size={16} /> Marcar entregue
        </button>
      )}
    </article>
  );
}

function Card({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--paper-raised)', border: '1px solid var(--line)' }}>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>{label}</p>
      <p className="font-display text-3xl mt-0.5" style={{ color: color || 'var(--ink)' }}>{value}</p>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
      <p className="text-xs" style={{ color: 'var(--ink-soft)' }}>{label}</p>
      <p className="font-mono text-xl font-semibold" style={{ color: 'var(--ink)' }}>{value}</p>
    </div>
  );
}
