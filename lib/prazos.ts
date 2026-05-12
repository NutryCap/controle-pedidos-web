export function parseDataBrasil(valor: any): Date | null {
  if (valor === null || valor === undefined || valor === '') return null;

  if (valor instanceof Date && !isNaN(valor.getTime())) return valor;

  if (typeof valor === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const data = new Date(excelEpoch.getTime() + valor * 86400000);
    return isNaN(data.getTime()) ? null : data;
  }

  const texto = String(valor).trim();
  if (!texto) return null;

  const partes = texto.split(/[\/\-]/);
  if (partes.length === 3) {
    const a = Number(partes[0]);
    const b = Number(partes[1]);
    const c = Number(partes[2]);

    if (!isNaN(a) && !isNaN(b) && !isNaN(c)) {
      let dia = a;
      let mes = b - 1;
      let ano = c;

      if (String(partes[0]).length === 4) {
        ano = a;
        mes = b - 1;
        dia = c;
      }

      if (ano < 100) ano += 2000;

      const data = new Date(ano, mes, dia);
      if (!isNaN(data.getTime())) return data;
    }
  }

  const tentativa = new Date(texto);
  return isNaN(tentativa.getTime()) ? null : tentativa;
}

export function adicionarDiasUteis(inicio: Date, diasUteis: number): Date {
  const data = new Date(inicio);
  let adicionados = 0;

  while (adicionados < diasUteis) {
    data.setDate(data.getDate() + 1);
    const diaSemana = data.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) adicionados++;
  }

  return data;
}

export function calcularPrazo(entrada: Date | null, diasUteis = 7) {
  if (!entrada || isNaN(entrada.getTime())) {
    return {
      prazoFinal: null as Date | null,
      diasUteisRestantes: null as number | null,
      situacaoPrazo: 'sem_data',
      mensagem: 'Sem data válida',
    };
  }

  const prazoFinal = adicionarDiasUteis(entrada, diasUteis);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  prazoFinal.setHours(0, 0, 0, 0);

  let diasUteisRestantes = 0;
  const cursor = new Date(hoje);
  const sinal = prazoFinal.getTime() >= hoje.getTime() ? 1 : -1;

  while (cursor.getTime() !== prazoFinal.getTime()) {
    cursor.setDate(cursor.getDate() + sinal);
    const diaSemana = cursor.getDay();
    if (diaSemana !== 0 && diaSemana !== 6) diasUteisRestantes += sinal;
  }

  if (diasUteisRestantes < 0) {
    return { prazoFinal, diasUteisRestantes, situacaoPrazo: 'atrasado', mensagem: 'Pedido atrasado' };
  }

  if (diasUteisRestantes <= 2) {
    return { prazoFinal, diasUteisRestantes, situacaoPrazo: 'proximo', mensagem: 'Prazo próximo do vencimento' };
  }

  return { prazoFinal, diasUteisRestantes, situacaoPrazo: 'normal', mensagem: 'Dentro do prazo' };
}

export function formatarData(valor: string | null) {
  if (!valor) return '-';
  const data = new Date(`${valor}T00:00:00`);
  if (isNaN(data.getTime())) return '-';
  return data.toLocaleDateString('pt-BR');
}
