import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Uso: npx tsx scripts/create-user.ts "Nome Completo" email@exemplo.com senha');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email: email.trim().toLowerCase() },
    update: { name, passwordHash },
    create: { name, email: email.trim().toLowerCase(), passwordHash },
  });

  console.log(`Usuário criado/atualizado: ${user.name} <${user.email}>`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
