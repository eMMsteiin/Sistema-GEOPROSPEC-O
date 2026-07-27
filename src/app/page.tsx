import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import LogoutButton from '@/components/logout-button';
import StoreMapView from '@/components/store-map-view';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div className="flex min-h-screen flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-gray-900">Mapa de PDVs</h1>
          <p className="text-xs text-gray-500">Olá, {session.name}</p>
        </div>
        <LogoutButton />
      </header>
      <StoreMapView />
    </div>
  );
}
