'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Erro ao entrar. Tente de novo.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Erro de conexão. Tente de novo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="hud-label mb-1.5 block text-gold-dim">E-mail</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="holo-input w-full rounded-sm px-3 py-2 text-sm"
        />
      </label>
      <label className="block">
        <span className="hud-label mb-1.5 block text-gold-dim">Senha</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="holo-input w-full rounded-sm px-3 py-2 text-sm"
        />
      </label>
      {error && <p className="text-sm text-[#ff8fa0]">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-sm bg-red-mid px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-red-deep disabled:opacity-50"
        style={{ boxShadow: '0 0 12px rgba(221,60,86,0.3)' }}
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
