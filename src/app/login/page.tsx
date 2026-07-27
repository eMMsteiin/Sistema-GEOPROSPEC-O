import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import LoginForm from '@/components/login-form';

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-gray-900">Mapa de PDVs</h1>
        <p className="mb-6 mt-1 text-sm text-gray-500">Prospecção de lojas de cosméticos</p>
        <LoginForm />
      </div>
    </main>
  );
}
