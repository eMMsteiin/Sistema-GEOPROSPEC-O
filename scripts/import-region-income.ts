// Importa a renda média municipal (Censo 2022, IBGE/SIDRA) para as 4 cidades do MVP
// e grava em RegionIncome com neighborhood = null (nível municipal).
//
// Fonte: API de agregados do IBGE (pública, sem key) — agregado 10295, variável 13431:
// "Valor do rendimento nominal médio mensal domiciliar per capita dos moradores em
// domicílios particulares permanentes ocupados" (R$, Censo 2022, nível N6/município).
//
// Uso: npx tsx scripts/import-region-income.ts

import { PrismaClient } from '@prisma/client';
import { IBGE_CODE_BY_CITY } from '../src/lib/pdv';

const prisma = new PrismaClient();

const AGGREGATE = '10295';
const VARIABLE = '13431';
const SOURCE = 'Censo 2022 IBGE - SIDRA tabela 10295, var. 13431 (rendimento domiciliar per capita, municipal)';

interface SidraSerie {
  localidade: { id: string; nome: string };
  serie: Record<string, string>;
}

async function main() {
  const cityByIbgeCode = new Map(
    Object.entries(IBGE_CODE_BY_CITY).map(([city, code]) => [code, city]),
  );
  const codes = [...cityByIbgeCode.keys()].join(',');
  const url =
    `https://servicodados.ibge.gov.br/api/v3/agregados/${AGGREGATE}/periodos/2022/` +
    `variaveis/${VARIABLE}?localidades=N6%5B${codes}%5D`;

  console.log(`Consultando SIDRA/IBGE: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SIDRA respondeu ${res.status} ${res.statusText}`);
  const data = await res.json();

  const series: SidraSerie[] = data?.[0]?.resultados?.[0]?.series ?? [];
  if (series.length === 0) throw new Error('SIDRA não retornou séries — resposta inesperada');

  for (const s of series) {
    const city = cityByIbgeCode.get(s.localidade.id);
    if (!city) {
      console.warn(`Localidade inesperada na resposta: ${s.localidade.id} (${s.localidade.nome}) — ignorando`);
      continue;
    }
    const raw = s.serie['2022'];
    const avgIncome = Number.parseFloat(raw);
    if (!Number.isFinite(avgIncome)) {
      console.warn(`Valor inválido pra ${city}: "${raw}" — ignorando`);
      continue;
    }

    const existing = await prisma.regionIncome.findFirst({
      where: { city, neighborhood: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.regionIncome.update({
        where: { id: existing.id },
        data: { avgIncome, source: SOURCE },
      });
      console.log(`Atualizado: ${city} — R$ ${avgIncome.toFixed(2)}`);
    } else {
      await prisma.regionIncome.create({
        data: { city, neighborhood: null, avgIncome, source: SOURCE },
      });
      console.log(`Criado: ${city} — R$ ${avgIncome.toFixed(2)}`);
    }
  }

  console.log('Renda por região importada com sucesso.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
