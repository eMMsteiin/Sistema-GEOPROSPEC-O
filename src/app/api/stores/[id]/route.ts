import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { cityTier } from '@/lib/pdv';
import type { EstablishmentKind, Prisma, ProspectStatus, StoreType } from '@prisma/client';

const PROSPECT_STATUSES: ProspectStatus[] = ['NOT_VISITED', 'VISITED', 'PARTNER', 'DECLINED'];
const STORE_TYPES: StoreType[] = ['MULTIBRAND', 'OWN_BRAND'];
const ESTABLISHMENT_KINDS: EstablishmentKind[] = ['PHYSICAL_STORE', 'INDIVIDUAL_RESELLER'];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const data: Prisma.StoreUpdateInput = {};

  if ('status' in body) {
    if (!PROSPECT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'Status de prospecção inválido' }, { status: 400 });
    }
    data.status = body.status;
  }

  if ('storeType' in body) {
    if (!STORE_TYPES.includes(body.storeType)) {
      return NextResponse.json({ error: 'Tipo de loja inválido' }, { status: 400 });
    }
    data.storeType = body.storeType;
    data.storeTypeAuto = false;
  }

  if ('establishmentKind' in body) {
    if (!ESTABLISHMENT_KINDS.includes(body.establishmentKind)) {
      return NextResponse.json({ error: 'Tipo de estabelecimento inválido' }, { status: 400 });
    }
    data.establishmentKind = body.establishmentKind;
    data.establishmentKindAuto = false;
  }

  if ('notes' in body) {
    if (body.notes !== null && typeof body.notes !== 'string') {
      return NextResponse.json({ error: 'Observações inválidas' }, { status: 400 });
    }
    data.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo editável informado' }, { status: 400 });
  }

  const existing = await prisma.store.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 });
  }

  const store = await prisma.store.update({ where: { id }, data });

  return NextResponse.json({ ...store, tier: cityTier(store.city) });
}
