import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { UserAccount, SystemRole } from '../types/auth';
import {
  apiLogin,
  apiLogout,
  getStoredUser,
  getLandingRouteForRole,
  isRouteAllowedForRole,
  saveAuthSession,
  clearAuthSession,
} from '../lib/auth';
import { supabase, SupabasePortalUser } from '../services/supabaseClient';

export interface AuthContextType {
  currentUser: UserAccount | null;
  isAuthenticated: boolean;
  role: SystemRole | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; user?: UserAccount; error?: string }>;
  logout: () => Promise<void>;
  createUserAccount: (newUserPayload: {
    username: string;
    password?: string;
    role: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT';
    full_name: string;
    phone: string;
    area?: string;
    base_salary?: number;
    cash_in_hand?: number;
  }) => Promise<{ success: boolean; user?: any; error?: string }>;
  canAccess: (tab: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(getStoredUser);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Sync active user session on startup & listen for auth session events
  useEffect(() => {
    const active = getStoredUser();
    setCurrentUser(active);
    setIsLoading(false);

    const handleStorage = () => {
      setCurrentUser(getStoredUser());
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('youthnet_auth_changed', handleStorage);

    // Supabase Realtime auth changes on portal_users
    const channel = supabase
      .channel('public:portal_users_auth')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, (payload) => {
        const activeUser = getStoredUser();
        if (activeUser && payload.new && (payload.new as any).id === activeUser.id) {
          const rawCash = Number((payload.new as any).cash_in_hand ?? activeUser.cashInHand ?? 0);
          const updated: UserAccount = {
            ...activeUser,
            fullName: (payload.new as any).full_name || activeUser.fullName,
            phone: (payload.new as any).phone || activeUser.phone,
            role: (payload.new as any).role || activeUser.role,
            area: (payload.new as any).area || activeUser.area || 'Central Zone',
            assignedArea: (payload.new as any).area || activeUser.area || 'Central Zone',
            cashInHand: rawCash,
            balance: rawCash,
          };
          saveAuthSession(`token_${Date.now()}`, updated);
          setCurrentUser(updated);
        }
      })
      .subscribe();

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('youthnet_auth_changed', handleStorage);
      supabase.removeChannel(channel);
    };
  }, []);

  const login = async (username: string, password: string) => {
    setIsLoading(true);
    try {
      const cleanUsername = username.trim().toLowerCase();
      const cleanPassword = password.trim();

      // PostgreSQL Direct Supabase Authentication Check
      let { data: user, error } = await supabase
        .from('portal_users')
        .select('*')
        .ilike('username', cleanUsername)
        .eq('password', cleanPassword)
        .maybeSingle();

      // If user provided short username without domain (e.g. hassnain), test with @youthnet.pk suffix
      if (!user && !cleanUsername.includes('@')) {
        const { data: userDomain } = await supabase
          .from('portal_users')
          .select('*')
          .ilike('username', `${cleanUsername}@youthnet.pk`)
          .eq('password', cleanPassword)
          .maybeSingle();
        if (userDomain) {
          user = userDomain;
        }
      }

      if (user) {
        const rawCash = Number(user.cash_in_hand || 0);
        const userAccount: UserAccount = {
          id: user.id,
          username: user.username,
          fullName: user.full_name || user.username,
          displayName: user.full_name || user.username,
          phone: user.phone || '+92 300 0000000',
          role: user.role,
          area: user.area || 'Central NOC Core',
          assignedArea: user.area || 'Central NOC Core',
          cashInHand: rawCash,
          balance: rawCash,
          email: user.username.includes('@') ? user.username : `${user.username}@youthnet.pk`,
          isActive: true,
          createdAt: user.created_at || new Date().toISOString(),
        };

        saveAuthSession(`supabase_token_${Date.now()}_${user.id}`, userAccount);
        setCurrentUser(userAccount);
        setIsLoading(false);
        return { success: true, user: userAccount };
      }

      // Fallback via unified apiLogin (handles local repository & test credentials)
      const res = await apiLogin(username, password);
      if (res.success && res.user) {
        setCurrentUser(res.user);
        setIsLoading(false);
        return { success: true, user: res.user };
      }

      setIsLoading(false);
      return { success: false, error: res.error || 'Invalid credentials' };
    } catch (err: any) {
      setIsLoading(false);
      return { success: false, error: err.message || 'Authentication error' };
    }
  };

  const logout = async () => {
    await apiLogout();
    clearAuthSession();
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      sessionStorage.clear();
      window.dispatchEvent(new Event('youthnet_auth_changed'));
      window.dispatchEvent(new Event('storage'));
    }
  };

  const createUserAccount = async (newUserPayload: {
    username: string;
    password?: string;
    role: 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT';
    full_name: string;
    phone: string;
    area?: string;
    base_salary?: number;
    cash_in_hand?: number;
  }) => {
    try {
      const payload = {
        username: newUserPayload.username.trim().toLowerCase(),
        password: (newUserPayload.password || 'client123').trim(),
        role: newUserPayload.role,
        full_name: newUserPayload.full_name.trim(),
        phone: newUserPayload.phone.trim() || '+92 300 0000000',
        area: newUserPayload.area?.trim() || 'Sector G-11',
        base_salary: newUserPayload.base_salary || 0,
        cash_in_hand: newUserPayload.cash_in_hand || 0,
        created_at: new Date().toISOString(),
      };

      const { data, error } = await supabase.from('portal_users').insert([payload]).select().maybeSingle();

      if (error) {
        console.warn('Supabase insert portal_users notice:', error);
      }

      return { success: !error, user: data, error: error?.message };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed creating user account' };
    }
  };

  const canAccess = (tab: string) => {
    if (!currentUser) return false;
    return isRouteAllowedForRole(currentUser.role, tab);
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated: !!currentUser,
        role: currentUser ? currentUser.role : null,
        isLoading,
        login,
        logout,
        createUserAccount,
        canAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    // Return safe fallback if outside provider
    const user = getStoredUser();
    return {
      currentUser: user,
      isAuthenticated: !!user,
      role: user ? user.role : null,
      isLoading: false,
      login: apiLogin,
      logout: apiLogout,
      createUserAccount: async () => ({ success: false, error: 'AuthContext not initialized' }),
      canAccess: (tab: string) => (user ? isRouteAllowedForRole(user.role, tab) : false),
    };
  }
  return context;
};
