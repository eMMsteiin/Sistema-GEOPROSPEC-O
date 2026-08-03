import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import LoginForm from '@/components/login-form';

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect('/');

  return (
    <main className="safe-top safe-bottom safe-x flex min-h-screen items-center justify-center p-4">
      <div className="holo-panel holo-corners rise relative w-full max-w-sm rounded-sm p-6">
        <p className="hud-label text-gold">Sistema de Geoprospecção</p>
        <h1 className="mt-1 text-xl font-bold text-ink">Vitiss Cosméticos — Melhorança</h1>
        <p className="mt-1 mb-6 text-sm text-ink-dim">Prospecção de lojas de cosméticos · RM Curitiba</p>
        <LoginForm />
      </div>
    </main>
  );
}
