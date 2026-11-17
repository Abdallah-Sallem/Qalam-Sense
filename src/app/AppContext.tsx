import { createContext, useContext } from 'react';
import type { AuthSession } from '@/domain/types';
import type { Services } from '@/services';

export interface AppState {
  services: Services;
  session: AuthSession | null;
  /** Re-reads the session from the auth service after sign-in, sign-out or expiry. */
  refreshSession: () => void;
}

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <App>');
  return ctx;
}
