import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { cityTier, normalizeName } from '@/lib/pdv';
import type { Prisma, ProspectStatus } from '@prisma/client';

const PROSPECT_STATUSES: ProspectStatus[] = ['NOT_VISITED', 'VISITED', 'PARTNER', 'DECLINED'];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const city = searchParams.get('city');
  const neighborhood = searchParams.get('neighborhood');
  const status = searchParams.get('status');
  const minIncome = searchParams.get('minIncome');
  const maxIncome = searchParams.get('maxIncome');

  const where: Prisma.StoreWhereInput = {};
  if (city) where.city = { equals: city, mode: 'insensitive' };
  if (neighborhood) where.neighborhood = { equals: neighborhood, mode: 'insensitive' };
  if (status) {
    if (!PROSPECT_STATUSES.includes(status as ProspectStatus)) {
      return NextResponse.json({ error: 'Status de prospecção inválido' }, { status: 400 });
    }
    where.status = status as ProspectStatus;
  }

  const [stores, incomes] = await Promise.all([
    prisma.store.findMany({ where, orderBy: { name: 'asc' } }),
    prisma.regionIncome.findMany(),
  ]);

  const byNeighborhood = new Map<string, { avgIncome: number; source: string | null }>();
  const byCity = new Map<string, { avgIncome: number; source: string | null }>();
  for (const inc of incomes) {
    const entry = { avgIncome: inc.avgIncome, source: inc.source };
    if (inc.neighborhood) {
      byNeighborhood.set(`${normalizeName(inc.city)}|${normalizeName(inc.neighborhood)}`, entry);
    } else {
      byCity.set(normalizeName(inc.city), entry);
    }
  }

  let result = stores.map((store) => {
    const income =
      (store.neighborhood
        ? byNeighborhood.get(`${normalizeName(store.city)}|${normalizeName(store.neighborhood)}`)
        : undefined) ?? byCity.get(normalizeName(store.city)) ?? null;
    return {
      ...store,
      avgIncome: income?.avgIncome ?? null,
      incomeSource: income?.source ?? null,
      tier: cityTier(store.city),
    };
  });

  const min = minIncome ? Number.parseFloat(minIncome) : null;
  const max = maxIncome ? Number.parseFloat(maxIncome) : null;
  if (min !== null && Number.isFinite(min)) {
    result = result.filter((s) => s.avgIncome !== null && s.avgIncome >= min);
  }
  if (max !== null && Number.isFinite(max)) {
    result = result.filter((s) => s.avgIncome !== null && s.avgIncome <= max);
  }

  return NextResponse.json(result);
}
