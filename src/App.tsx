import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ThemeProvider } from './context/ThemeContext';
import { CurrencyProvider } from './context/CurrencyContext';
import { AuthProvider } from './context/AuthContext';
import { ISPProvider, useISP } from './context/ISPContext';
import { PermissionProvider } from './context/PermissionContext';
import { Sidebar } from './components/Sidebar';
import { Header, ActiveTab } from './components/Header';
import { NocCommandCenter } from './components/NocCommandCenter';
import { CapacityPlannerView } from './components/CapacityPlannerView';
import { MikrotikStudio } from './components/MikrotikStudio';
import { VsolOltStudio } from './components/VsolOltStudio';
import { FiberGisMapView } from './components/FiberGisMapView';
import { BillingStudio } from './components/BillingStudio';
import { DealersManagementView } from './components/DealersManagementView';
import { WhatsAppGatewayView } from './components/WhatsAppGatewayView';
import { ProfitLossLedgerView } from './components/ProfitLossLedgerView';
import { InventoryHardwareView } from './components/InventoryHardwareView';
import { ComplaintsStudio } from './components/ComplaintsStudio';
import { MobileAppSimulator } from './components/MobileAppSimulator';
import { UserManagementStudio } from './components/UserManagementStudio';
import { PermissionMatrixStudio } from './components/PermissionMatrixStudio';
import { ArchitectureStudio } from './components/ArchitectureStudio';
import { SettingsStudio } from './components/SettingsStudio';
import { ManagerOperationsDashboard } from './components/ManagerOperationsDashboard';
import { FieldAgentPortal } from './components/FieldAgentPortal';
import { ClientSubscriberPortal } from './components/ClientSubscriberPortal';
import { AccessDeniedView } from './components/AccessDeniedView';
import { LoginPage } from './components/LoginPage';
import { ActivityLogsStudio } from './components/ActivityLogsStudio';
import { ProvisionSecretModal } from './components/ProvisionSecretModal';
import { OutageBroadcasterModal } from './components/OutageBroadcasterModal';
import { NewTicketModal } from './components/NewTicketModal';
import { ReceiptModal } from './components/ReceiptModal';
import { CashPaymentModal } from './components/CashPaymentModal';
import { AddMikrotikDeviceModal } from './components/AddMikrotikDeviceModal';
import { PWAInstallPrompt } from './components/PWAInstallPrompt';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FieldAgentGpsGuard } from './components/FieldAgentGpsGuard';
import { markAgentLocationOffline } from './services/agentGpsService';
import { Invoice } from './types/isp';
import { SystemRole, UserAccount } from './types/auth';
import {
  getStoredUser,
  apiLogout,
  isRouteAllowedForRole,
  saveAuthSession,
  getStoredToken,
  isOriginalAdminSession,
  getTabFromPath,
  getPathFromTab,
  getLandingRouteForRole,
} from './lib/auth';
import {
  GIS_PERMISSION_UPDATED_EVENT,
  GisMapPermission,
  resolveUserGisAccess,
} from './lib/gisAccessControl';
import {
  STAFF_PERMISSIONS_UPDATED_EVENT,
  StaffPermissions,
  fetchLiveStaffPermissionsFromSupabase,
  resolveStaffPermissions,
} from './lib/staffPermissions';
import {
  RESELLER_WALLET_UPDATED_EVENT,
  fetchLiveResellerWalletSnapshot,
  isResellerUser,
} from './lib/resellerEngine';
import { supabase } from './services/supabaseClient';
import { Radio, ShieldCheck, Database, ShieldAlert, ArrowLeft, WifiOff, RefreshCw, CheckCircle2, X } from 'lucide-react';
import {
  QueuedApiRequest,
  SyncQueueProgress,
  buildOfflineQueuedResponse,
  enqueueOfflineApiRequest,
  extractSerializableBody,
  getNativeFetch,
  getQueuedApiRequests,
  isNetworkFetchError,
  normalizeHeaders,
  normalizeUrl,
  shouldCaptureOfflineApiRequest,
  syncIndexedDbApiQueue,
} from './lib/indexedDbRequestQueue';
import {
  SqliteAdapterStats,
  SqliteSyncProgress,
  sqliteOfflineAdapter,
} from './lib/sqliteOfflineAdapter';
import {
  OfflineConnectivitySnapshot,
  flushGpsBreadcrumbsToSupabase,
  getConnectivitySnapshot,
  hydrateOfflineQueueFromIndexedDb,
  probeSupabaseReachability,
  reportSupabaseReachability,
  subscribeOfflineFieldConnectivity,
} from './lib/offlineFieldQueue';
import { offlineSyncManager } from './services/OfflineSyncManager';

function getLandingTabForRole(role: SystemRole): ActiveTab {
  switch (role) {
    case 'ADMIN':
      return 'noc';
    case 'MANAGER':
      return 'operations';
    case 'DEALER':
      return 'dealers';
    case 'SUB_DEALER':
      return 'billing';
    case 'AGENT':
      return 'agent_portal';
    case 'CLIENT':
      return 'client_portal';
    default:
      return 'noc';
  }
}

function ISPAppContent() {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => getStoredUser());
  const [currentRole, setCurrentRole] = useState<SystemRole>(() => {
    const user = getStoredUser();
    return user?.role || 'ADMIN';
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const user = getStoredUser();
    if (!user) return 'noc';
    const pathTab = typeof window !== 'undefined' ? getTabFromPath(window.location.pathname) : null;
    if (user.role === 'AGENT') {
      if (
        pathTab === 'fiber_gis' ||
        pathTab === 'mikrotik' ||
        pathTab === 'olt' ||
        pathTab === 'profit_expenses'
      ) {
        return pathTab as ActiveTab;
      }
      return 'agent_portal';
    }
    if (user.role === 'CLIENT') return 'client_portal';
    if (pathTab && isRouteAllowedForRole(user.role, pathTab, user)) {
      return pathTab as ActiveTab;
    }
    return getLandingTabForRole(user.role);
  });

  // Live-sync logged-in user's full RBAC permissions JSONB & GIS access from Supabase portal_users + realtime
  useEffect(() => {
    if (!currentUser || currentUser.role === 'ADMIN' || currentUser.role === 'CLIENT') {
      return;
    }

    let cancelled = false;

    const applyPermissionUpdate = (
      nextPermissions: StaffPermissions
    ) => {
      const canAccess = nextPermissions.gis_map !== 'none';
      const gisPerm: GisMapPermission = nextPermissions.gis_map;
      setCurrentUser((prev) => {
        if (!prev) return prev;
        const prevSerialized = JSON.stringify(prev.permissions || {});
        const nextSerialized = JSON.stringify(nextPermissions);
        if (
          prev.can_access_gis_map === canAccess &&
          prev.gis_map_permission === gisPerm &&
          prevSerialized === nextSerialized
        ) {
          return prev;
        }
        const nextUser: UserAccount = {
          ...prev,
          can_access_gis_map: canAccess,
          gis_map_permission: gisPerm,
          permissions: nextPermissions,
        };
        const token = getStoredToken();
        if (token) {
          saveAuthSession(token, nextUser, true);
        }
        return nextUser;
      });
    };

    const syncFromDb = async () => {
      const [live, liveWallet] = await Promise.all([
        fetchLiveStaffPermissionsFromSupabase(currentUser),
        isResellerUser(currentUser) ? fetchLiveResellerWalletSnapshot(currentUser) : Promise.resolve(null),
      ]);
      if (!cancelled && live?.permissions) {
        const resolved = resolveStaffPermissions(
          {
            ...currentUser,
            permissions: live.permissions,
            can_access_gis_map: live.can_access_gis_map,
            gis_map_permission: live.gis_map_permission,
          },
          currentUser.role
        );
        applyPermissionUpdate(resolved);
      }
      if (!cancelled && liveWallet) {
        setCurrentUser((prev) => {
          if (!prev) return prev;
          if (
            prev.wallet_balance === liveWallet.wallet_balance &&
            prev.credit_limit === liveWallet.credit_limit &&
            prev.can_create_subdealers === liveWallet.can_create_subdealers
          ) {
            return prev;
          }
          const nextUser: UserAccount = { ...prev, ...liveWallet };
          const token = getStoredToken();
          if (token) saveAuthSession(token, nextUser, true);
          return nextUser;
        });
      }
    };

    void syncFromDb();

    const handleWalletUpdated = (evt: Event) => {
      const detail = (evt as CustomEvent).detail;
      if (!detail || detail.resellerId !== currentUser.id) return;
      setCurrentUser((prev) => {
        if (!prev) return prev;
        const nextUser: UserAccount = { ...prev, wallet_balance: Number(detail.walletBalance ?? prev.wallet_balance ?? 0) };
        const token = getStoredToken();
        if (token) saveAuthSession(token, nextUser, true);
        return nextUser;
      });
    };

    const handleStaffPermsEvent = (evt: Event) => {
      const detail = (evt as CustomEvent).detail;
      if (!detail?.permissions) return;
      const matchesId = detail.userId && detail.userId === currentUser.id;
      const matchesUsername =
        detail.username &&
        detail.username.toLowerCase() === (currentUser.username || '').toLowerCase();
      if (matchesId || matchesUsername) {
        applyPermissionUpdate(detail.permissions as StaffPermissions);
      }
    };

    const handleGisEvent = (evt: Event) => {
      const detail = (evt as CustomEvent).detail;
      if (!detail) return;
      const matchesId = detail.userId && detail.userId === currentUser.id;
      const matchesUsername =
        detail.username &&
        detail.username.toLowerCase() === (currentUser.username || '').toLowerCase();
      if (matchesId || matchesUsername) {
        const base = resolveStaffPermissions(currentUser, currentUser.role);
        applyPermissionUpdate({
          ...base,
          gis_map: (detail.gis_map_permission as GisMapPermission) || (detail.can_access_gis_map ? 'view' : 'none'),
        });
      }
    };

    window.addEventListener(STAFF_PERMISSIONS_UPDATED_EVENT, handleStaffPermsEvent);
    window.addEventListener(GIS_PERMISSION_UPDATED_EVENT, handleGisEvent);
    window.addEventListener(RESELLER_WALLET_UPDATED_EVENT, handleWalletUpdated);

    const channel = supabase
      .channel(`portal_user_rbac_${currentUser.id || currentUser.username}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'portal_users' },
        (payload) => {
          const row = payload.new as any;
          if (!row) return;
          const matchesId = row.id && row.id === currentUser.id;
          const matchesUsername =
            row.username &&
            String(row.username).toLowerCase() === (currentUser.username || '').toLowerCase();
          if (matchesId || matchesUsername) {
            const resolved = resolveStaffPermissions(row, row.role || currentUser.role);
            applyPermissionUpdate(resolved);
            if (typeof row.wallet_balance === 'number' || typeof row.credit_limit === 'number') {
              setCurrentUser((prev) => {
                if (!prev) return prev;
                const nextUser: UserAccount = {
                  ...prev,
                  wallet_balance: Number(row.wallet_balance ?? prev.wallet_balance ?? 0),
                  credit_limit: Number(row.credit_limit ?? prev.credit_limit ?? 0),
                  bandwidth_pool_cap_mbps: Number(
                    row.bandwidth_pool_cap_mbps ?? row.assigned_pool_mbps ?? prev.bandwidth_pool_cap_mbps ?? 0
                  ),
                  max_active_users: Number(row.max_active_users ?? prev.max_active_users ?? 0),
                  can_create_subdealers: Boolean(row.can_create_subdealers ?? prev.can_create_subdealers),
                };
                const token = getStoredToken();
                if (token) saveAuthSession(token, nextUser, true);
                return nextUser;
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.removeEventListener(STAFF_PERMISSIONS_UPDATED_EVENT, handleStaffPermsEvent);
      window.removeEventListener(GIS_PERMISSION_UPDATED_EVENT, handleGisEvent);
      window.removeEventListener(RESELLER_WALLET_UPDATED_EVENT, handleWalletUpdated);
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, currentUser?.username, currentUser?.role]);

  const { setActiveViewTab } = useISP();
  useEffect(() => {
    setActiveViewTab?.(activeTab);
  }, [activeTab, setActiveViewTab]);

  // Synchronize browser address bar with RBAC path
  useEffect(() => {
    if (!currentUser) {
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.history.replaceState(null, '', '/login');
      }
      return;
    }

    const agentAllowedTabs: ActiveTab[] = ['agent_portal', 'fiber_gis', 'mikrotik', 'olt', 'profit_expenses'];
    if (currentUser.role === 'AGENT' && !agentAllowedTabs.includes(activeTab)) {
      setActiveTab('agent_portal');
      return;
    }
    if (currentUser.role === 'CLIENT' && activeTab !== 'client_portal') {
      setActiveTab('client_portal');
      return;
    }

    const expectedPath = getPathFromTab(activeTab);
    if (typeof window !== 'undefined' && window.location.pathname !== expectedPath) {
      window.history.replaceState(null, '', expectedPath);
    }
  }, [currentUser, activeTab]);

  // Browser navigation popstate listener
  useEffect(() => {
    const handlePopState = () => {
      const user = getStoredUser();
      if (!user) {
        setCurrentUser(null);
        return;
      }
      const pathTab = getTabFromPath(window.location.pathname);
      if (user.role === 'AGENT') {
        const agentAllowedTabs = ['fiber_gis', 'mikrotik', 'olt', 'profit_expenses'];
        setActiveTab(pathTab && agentAllowedTabs.includes(pathTab) ? (pathTab as ActiveTab) : 'agent_portal');
      } else if (user.role === 'CLIENT') {
        setActiveTab('client_portal');
      } else if (pathTab && isRouteAllowedForRole(user.role, pathTab, user)) {
        setActiveTab(pathTab as ActiveTab);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Sidebar collapsible state (HIDDEN by default)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Modals state
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [isOutageOpen, setIsOutageOpen] = useState(false);
  const [isTicketOpen, setIsTicketOpen] = useState(false);
  const [isAddRouterOpen, setIsAddRouterOpen] = useState(false);
  const [selectedReceiptInvoice, setSelectedReceiptInvoice] = useState<Invoice | null>(null);
  const [selectedPaymentInvoice, setSelectedPaymentInvoice] = useState<Invoice | null>(null);

  // Close sidebar on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen]);

  // IndexedDB Offline API Request Queue (captures agent mutations while offline & auto-syncs on reconnect)
  const isAgentSession = Boolean(
    currentUser && (currentRole === 'AGENT' || currentUser.role === 'AGENT')
  );
  const activeAgentId = currentUser
    ? currentUser.linkedAgentId || currentUser.id || currentUser.username
    : '';

  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [offlineQueuedRequests, setOfflineQueuedRequests] = useState<QueuedApiRequest[]>([]);
  const [isSyncingOfflineQueue, setIsSyncingOfflineQueue] = useState<boolean>(false);
  const [queueSyncProgress, setQueueSyncProgress] = useState<SyncQueueProgress | null>(null);
  const [sqliteStats, setSqliteStats] = useState<SqliteAdapterStats>(() =>
    sqliteOfflineAdapter.getCachedStats()
  );
  const [sqliteDatasetProgress, setSqliteDatasetProgress] = useState<SqliteSyncProgress | null>(null);
  const [connectivityState, setConnectivityState] = useState<OfflineConnectivitySnapshot>(() =>
    getConnectivitySnapshot()
  );
  const [offlineSyncNotice, setOfflineSyncNotice] = useState<string | null>(null);
  const isSyncingQueueRef = useRef<boolean>(false);

  const refreshOfflineQueue = useCallback(async () => {
    if (!isAgentSession || !activeAgentId) {
      setOfflineQueuedRequests([]);
      return;
    }
    const items = await getQueuedApiRequests(activeAgentId);
    setOfflineQueuedRequests(items);
  }, [activeAgentId, isAgentSession]);

  const runOfflineQueueSync = useCallback(
    async (verifyReachabilityFirst = false) => {
      if (!isAgentSession || !activeAgentId || isSyncingQueueRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        reportSupabaseReachability(false);
        return;
      }

      if (verifyReachabilityFirst) {
        const ok = await probeSupabaseReachability();
        if (!ok) return;
      }

      isSyncingQueueRef.current = true;
      setIsSyncingOfflineQueue(true);
      setQueueSyncProgress(null);
      try {
        const [gpsRes, outboxRes, apiRes] = await Promise.all([
          flushGpsBreadcrumbsToSupabase(activeAgentId),
          offlineSyncManager.autoSyncOutbox(activeAgentId, currentRole),
          syncIndexedDbApiQueue(activeAgentId, (progress) => {
            setQueueSyncProgress(progress);
          }),
        ]);

        const remaining = await getQueuedApiRequests(activeAgentId);
        setOfflineQueuedRequests(remaining);
        setConnectivityState(getConnectivitySnapshot(remaining.length));
        void sqliteOfflineAdapter.refreshStats();

        const totalSynced = gpsRes.syncedCount + outboxRes.syncedCount + apiRes.syncedCount;
        if (totalSynced > 0) {
          setOfflineSyncNotice(
            `Auto-synced ${totalSynced} queued offline item${
              totalSynced === 1 ? '' : 's'
            } (${gpsRes.syncedCount} GPS, ${outboxRes.syncedCount} field action, ${
              apiRes.syncedCount
            } API) to Supabase.`
          );
          window.dispatchEvent(
            new CustomEvent('youthnet-offline-api-synced', {
              detail: { agentId: activeAgentId, syncedCount: totalSynced },
            })
          );
        }
      } finally {
        isSyncingQueueRef.current = false;
        setIsSyncingOfflineQueue(false);
        setQueueSyncProgress(null);
      }
    },
    [activeAgentId, currentRole, isAgentSession]
  );

  useEffect(() => {
    if (!isAgentSession) return;
    void sqliteOfflineAdapter.init();
    void hydrateOfflineQueueFromIndexedDb();
    const unsubStats = sqliteOfflineAdapter.subscribeStats(setSqliteStats);
    const unsubProgress = sqliteOfflineAdapter.subscribeProgress(setSqliteDatasetProgress);
    const unsubConn = subscribeOfflineFieldConnectivity((snap) => {
      setConnectivityState(snap);
    });

    // Periodic reachability probe handles WhatsApp-only mobile SIM packages where
    // navigator.onLine stays true while Supabase is temporarily unreachable.
    const probeTimer = window.setInterval(async () => {
      const wasBlocked = getConnectivitySnapshot().isOfflineOrBlocked;
      const reachable = await probeSupabaseReachability();
      if (reachable) {
        const snap = getConnectivitySnapshot();
        if (wasBlocked || snap.totalQueuedItems > 0) {
          void runOfflineQueueSync(false);
        }
      }
    }, 20000);

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void runOfflineQueueSync(true);
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.clearInterval(probeTimer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      unsubStats();
      unsubProgress();
      unsubConn();
    };
  }, [isAgentSession, runOfflineQueueSync]);

  useEffect(() => {
    if (!offlineSyncNotice) return;
    const timer = window.setTimeout(() => setOfflineSyncNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [offlineSyncNotice]);

  useEffect(() => {
    if (!isAgentSession || !activeAgentId || typeof window === 'undefined') {
      return;
    }

    const nativeFetch = getNativeFetch();

    const interceptedFetch: typeof window.fetch = async (input, init) => {
      const url = normalizeUrl(input);
      const method = (
        init?.method ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const headers = normalizeHeaders(input, init);

      if (!shouldCaptureOfflineApiRequest(url, method, headers)) {
        return nativeFetch(input, init);
      }

      const { serializable, body } = await extractSerializableBody(input, init);
      if (!serializable) {
        return nativeFetch(input, init);
      }

      const queueAndRespond = async (): Promise<Response> => {
        const queued = await enqueueOfflineApiRequest({
          agentId: activeAgentId,
          url,
          method: method as QueuedApiRequest['method'],
          headers,
          body,
        });
        await refreshOfflineQueue();
        return buildOfflineQueuedResponse(url, headers, queued.id);
      };

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return queueAndRespond();
      }

      try {
        const res = await nativeFetch(input, init);
        if (url.toLowerCase().includes('/rest/v1/')) {
          reportSupabaseReachability(true);
        }
        return res;
      } catch (err) {
        if (isNetworkFetchError(err)) {
          reportSupabaseReachability(false);
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            setIsNetworkOnline(false);
          }
          return queueAndRespond();
        }
        throw err;
      }
    };

    window.fetch = interceptedFetch;

    const handleOnline = () => {
      setIsNetworkOnline(true);
      void runOfflineQueueSync(true);
    };

    const handleOffline = () => {
      setIsNetworkOnline(false);
      reportSupabaseReachability(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    void refreshOfflineQueue();
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      void runOfflineQueueSync();
    }

    return () => {
      window.fetch = nativeFetch;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [activeAgentId, isAgentSession, refreshOfflineQueue, runOfflineQueueSync]);

  // Handle Login success
  const handleLoginSuccess = (user: UserAccount) => {
    setCurrentUser(user);
    setCurrentRole(user.role);
    const landingTab = getLandingTabForRole(user.role);
    setActiveTab(landingTab);
    const landingPath = getLandingRouteForRole(user.role);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', landingPath);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    if (currentUser && (currentUser.role === 'AGENT' || currentRole === 'AGENT')) {
      const agentId = currentUser.linkedAgentId || currentUser.id || currentUser.username;
      await markAgentLocationOffline(agentId);
    }
    try {
      await apiLogout();
    } catch {}
    try {
      sessionStorage.clear();
      localStorage.removeItem('netpulse_active_user');
      localStorage.removeItem('youthnet_active_session');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
    } catch {}
    setCurrentUser(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  };

  // Handle Role Switching for Testing/Simulation (Guarded strictly to genuine ADMIN sessions)
  const handleSwitchRole = (newRole: SystemRole) => {
    const isOriginalAdmin = isOriginalAdminSession();
    // Production Role Guard: Client accounts must NEVER escalate privilege
    if (currentUser?.role === 'CLIENT' || !isOriginalAdmin) {
      console.warn('Security Alert: Unauthorized role escalation blocked for client session.');
      return;
    }
    setCurrentRole(newRole);
    if (currentUser) {
      const updatedUser: UserAccount = { ...currentUser, role: newRole };
      setCurrentUser(updatedUser);
      const token = getStoredToken() || `sim-token-${Date.now()}`;
      saveAuthSession(token, updatedUser, true);
    }
    setActiveTab(getLandingTabForRole(newRole));
  };

  // Guard Outage Broadcaster modal (Never accessible to Client)
  const handleOpenOutage = () => {
    if (currentRole === 'CLIENT' || currentUser?.role === 'CLIENT') {
      console.warn('Security Alert: Outage broadcasting is strictly prohibited for client accounts.');
      return;
    }
    setIsOutageOpen(true);
  };

  const handleOpenReceipt = (invoice: Invoice) => {
    setSelectedReceiptInvoice(invoice);
  };

  const handleOpenPayment = (invoice: Invoice) => {
    setSelectedPaymentInvoice(invoice);
  };

  const handlePaymentSuccess = (invoice: Invoice, receiptNum: string) => {
    setSelectedPaymentInvoice(null);
    setSelectedReceiptInvoice({ ...invoice, receiptNumber: receiptNum });
  };

  // If unauthenticated, display sleek Login Page
  if (!currentUser) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  // Route permission validation + complete granular per-user RBAC enforcement
  const staffPerms = resolveStaffPermissions(currentUser, currentRole);
  const gisAccess = resolveUserGisAccess(currentUser, currentRole);
  const isGisAccessBlocked = activeTab === 'fiber_gis' && staffPerms.gis_map === 'none';
  const isMikrotikBlocked = activeTab === 'mikrotik' && !staffPerms.mikrotik_panel;
  const isOltBlocked = activeTab === 'olt' && !staffPerms.olt_panel;
  const isExpensesBlocked = activeTab === 'profit_expenses' && !staffPerms.expenses_ledger;
  const isPermitted =
    isRouteAllowedForRole(currentRole, activeTab, currentUser) &&
    !isGisAccessBlocked &&
    !isMikrotikBlocked &&
    !isOltBlocked &&
    !isExpensesBlocked;
  const isClient = currentRole === 'CLIENT' || currentUser.role === 'CLIENT';
  const isAgent = currentRole === 'AGENT' || currentUser.role === 'AGENT';
  const isOriginalAdmin = isOriginalAdminSession();

  const handleGuardedOpenProvision = () => {
    if (!staffPerms.provision_pppoe) return;
    setIsProvisionOpen(true);
  };

  const handleGuardedOpenOutage = () => {
    if (!staffPerms.outage_broadcast || isClient) return;
    handleOpenOutage();
  };

  const handleGuardedOpenPayment = (invoice: Invoice) => {
    if (!staffPerms.collect_fee && !isClient) return;
    handleOpenPayment(invoice);
  };

  return (
    <div className="flex h-screen w-full max-w-full overflow-hidden overflow-x-hidden bg-slate-50 text-slate-900 dark:bg-[#0B111E] dark:text-slate-100 font-sans selection:bg-cyan-500 selection:text-white transition-colors duration-200">
      {/* 1. Off-Canvas Collapsible Sidebar (Strictly hidden for Client subscribers and Field Agents) */}
      {!isClient && !isAgent && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          activeTab={activeTab}
          setActiveTab={(tab) => {
            setActiveTab(tab);
            setIsSidebarOpen(false);
          }}
          onOpenProvisionModal={() => {
            handleGuardedOpenProvision();
            setIsSidebarOpen(false);
          }}
          onOpenOutageModal={() => {
            handleGuardedOpenOutage();
            setIsSidebarOpen(false);
          }}
          onOpenTicketModal={() => {
            setIsTicketOpen(true);
            setIsSidebarOpen(false);
          }}
          currentRole={currentRole}
          onSwitchRole={isOriginalAdmin ? handleSwitchRole : undefined}
          currentUser={currentUser}
          onLogout={handleLogout}
          canAccessGisMap={staffPerms.gis_map !== 'none'}
          staffPermissions={staffPerms}
        />
      )}

      {/* 2. Main Flex Viewport (Navbar + Scrollable Body + Footer) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 w-full max-w-full">
        {/* Top Navbar / Header Bar with Menu Toggle Button */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onOpenProvisionModal={handleGuardedOpenProvision}
          onOpenOutageModal={handleGuardedOpenOutage}
          onOpenTicketModal={() => setIsTicketOpen(true)}
          onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
          onOpenPaymentModal={handleGuardedOpenPayment}
          onOpenReceiptModal={handleOpenReceipt}
          currentRole={currentRole}
          onSwitchRole={isOriginalAdmin ? handleSwitchRole : undefined}
          currentUser={currentUser}
          onLogout={handleLogout}
          canAccessGisMap={staffPerms.gis_map !== 'none'}
          staffPermissions={staffPerms}
          offlineModeStatus={
            isAgent
              ? {
                  isOfflineOrBlocked:
                    !isNetworkOnline || connectivityState.isOfflineOrBlocked,
                  isAutoSyncing: isSyncingOfflineQueue,
                  queuedCount:
                    connectivityState.gpsBreadcrumbsCount +
                    connectivityState.pendingPaymentsCount +
                    offlineQueuedRequests.length,
                  onRetrySync: () => void runOfflineQueueSync(true),
                }
              : undefined
          }
        />

        {/* RBAC Role Indicator Banner (Strictly hidden for logged-in CLIENT, AGENT, and MANAGER) */}
        {currentRole !== 'ADMIN' && isOriginalAdmin && currentUser.role === 'ADMIN' && (
          <div className="bg-white dark:bg-slate-900 border-b border-indigo-200 dark:border-indigo-900/60 text-slate-700 dark:text-slate-300 text-xs px-4 py-2 font-mono flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-sky-600 dark:text-cyan-400 shrink-0" />
              <span>
                Active RBAC Profile: Logged in as <strong className="text-slate-900 dark:text-white">{currentUser.fullName || currentUser.username}</strong> (<span className="text-sky-700 dark:text-cyan-400 font-bold">{currentRole}</span>).
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSwitchRole('ADMIN')}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] cursor-pointer transition"
                title="Return to Administrator Profile"
              >
                Switch to Admin
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Main Content Body */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 sm:p-6 pb-16 sm:pb-8 bg-slate-50 dark:bg-[#0B111E] text-slate-900 dark:text-slate-100 transition-colors duration-200">
          <div className="w-full max-w-7xl mx-auto min-w-0 space-y-5 sm:space-y-6">
            {/* Non-blocking Live GPS Tracking & Dismissible Warning Banner for Field Agents */}
            {isAgent && (
              <FieldAgentGpsGuard currentUser={currentUser} />
            )}

            {/* Local SQLite & IndexedDB Offline API Queue Status Bar (Field Agents) */}
            {isAgent &&
              (!isNetworkOnline ||
                connectivityState.isOfflineOrBlocked ||
                connectivityState.totalQueuedItems > 0 ||
                offlineQueuedRequests.length > 0 ||
                isSyncingOfflineQueue ||
                sqliteDatasetProgress !== null ||
                offlineSyncNotice) && (
                <div
                  className={`w-full rounded-xl border px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono shadow-sm ${
                    !isNetworkOnline || connectivityState.isOfflineOrBlocked
                      ? 'bg-amber-950/75 border-amber-600/60 text-amber-100'
                      : isSyncingOfflineQueue || sqliteDatasetProgress
                      ? 'bg-cyan-950/75 border-cyan-600/60 text-cyan-100'
                      : connectivityState.totalQueuedItems + offlineQueuedRequests.length > 0
                      ? 'bg-indigo-950/75 border-indigo-600/60 text-indigo-100'
                      : 'bg-emerald-950/75 border-emerald-600/60 text-emerald-100'
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {!isNetworkOnline || connectivityState.isOfflineOrBlocked ? (
                      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
                    ) : isSyncingOfflineQueue || sqliteDatasetProgress ? (
                      <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                    ) : connectivityState.totalQueuedItems + offlineQueuedRequests.length > 0 ? (
                      <Database className="w-4 h-4 text-indigo-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    )}

                    <span className="truncate sm:whitespace-normal">
                      {!isNetworkOnline || connectivityState.isOfflineOrBlocked
                        ? `Offline / Restricted Bundle Mode — ${
                            connectivityState.gpsBreadcrumbsCount
                          } GPS, ${connectivityState.pendingPaymentsCount} payments, ${
                            offlineQueuedRequests.length
                          } API queued • SQLite: ${sqliteStats.nodesCount} nodes`
                        : isSyncingOfflineQueue
                        ? `🔄 Auto-Syncing to DB... (${
                            queueSyncProgress
                              ? `${queueSyncProgress.processed}/${queueSyncProgress.total}`
                              : `${connectivityState.totalQueuedItems + offlineQueuedRequests.length} items`
                          })`
                        : sqliteDatasetProgress
                        ? `SQLite Background Cache (${sqliteDatasetProgress.dataset}): ${sqliteDatasetProgress.processed}/${sqliteDatasetProgress.total} rows`
                        : connectivityState.totalQueuedItems + offlineQueuedRequests.length > 0
                        ? `${
                            connectivityState.totalQueuedItems + offlineQueuedRequests.length
                          } offline item(s) queued & ready to sync.`
                        : offlineSyncNotice}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {connectivityState.totalQueuedItems + offlineQueuedRequests.length > 0 && (
                      <button
                        type="button"
                        onClick={() => void runOfflineQueueSync(true)}
                        disabled={isSyncingOfflineQueue}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold flex items-center gap-1 cursor-pointer transition"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${isSyncingOfflineQueue ? 'animate-spin' : ''}`}
                        />
                        <span>{isSyncingOfflineQueue ? 'Syncing...' : 'Sync Now'}</span>
                      </button>
                    )}

                    {offlineSyncNotice &&
                      connectivityState.totalQueuedItems + offlineQueuedRequests.length === 0 &&
                      isNetworkOnline &&
                      !connectivityState.isOfflineOrBlocked && (
                        <button
                          type="button"
                          onClick={() => setOfflineSyncNotice(null)}
                          aria-label="Dismiss sync notice"
                          className="p-1 rounded-md hover:bg-emerald-900/60 text-emerald-300 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                  </div>
                </div>
              )}

            {/* PWA Mobile Install Banner (Admin only) */}
            {currentRole === 'ADMIN' && (
              <PWAInstallPrompt role={currentRole} variant="banner" forceVisibleOnDesktop={false} />
            )}

            {/* Route Protection Guard: If current role/user lacks permission, show 403 Restricted screen */}
            {!isPermitted ? (
              <AccessDeniedView
                currentRole={currentRole}
                attemptedResource={
                  isGisAccessBlocked
                    ? 'Fiber GIS & Map'
                    : isMikrotikBlocked
                    ? 'MikroTik RouterOS v7'
                    : isOltBlocked
                    ? 'VSOL OLT GPON'
                    : isExpensesBlocked
                    ? 'Profit & Expenses Ledger'
                    : activeTab
                }
                customTitle={
                  isGisAccessBlocked
                    ? 'Access Restricted: Fiber GIS & Map Disabled'
                    : isMikrotikBlocked
                    ? 'Access Restricted: MikroTik RouterOS Panel Disabled'
                    : isOltBlocked
                    ? 'Access Restricted: VSOL OLT GPON Panel Disabled'
                    : isExpensesBlocked
                    ? 'Access Restricted: Profit & Expenses Disabled'
                    : undefined
                }
                customMessage={
                  isGisAccessBlocked
                    ? 'Access Restricted: Fiber GIS & Map is disabled for your account by Admin.'
                    : isMikrotikBlocked
                    ? 'MikroTik RouterOS v7 Tab Access is disabled for your staff profile. Ask an Administrator to enable mikrotik_panel.'
                    : isOltBlocked
                    ? 'VSOL OLT GPON Tab Access is disabled for your staff profile. Ask an Administrator to enable olt_panel.'
                    : isExpensesBlocked
                    ? 'Office Expenses & Profit Ledger access is disabled for your staff profile. Ask an Administrator to enable expenses_ledger.'
                    : undefined
                }
                requiredAuthLabel={
                  isGisAccessBlocked || isMikrotikBlocked || isOltBlocked || isExpensesBlocked
                    ? 'Admin Granular RBAC Permission Grant (portal_users)'
                    : undefined
                }
                onReturnToAllowed={() => setActiveTab(getLandingTabForRole(currentRole))}
              />
            ) : (
              <>
                {/* 1. Admin NOC Command Center */}
                {activeTab === 'noc' && (
                  <NocCommandCenter
                    onNavigateTab={(tab) => setActiveTab(tab)}
                    onOpenOutageModal={handleGuardedOpenOutage}
                    onOpenTicketModal={() => setIsTicketOpen(true)}
                    onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
                    staffPermissions={staffPerms}
                  />
                )}

                {/* 1b. Bandwidth Pool, 1:6 Contention & Upstream Capacity Planner */}
                {activeTab === 'capacity' && <CapacityPlannerView />}

                {/* 2. Operations & Dispatch (Customized for Manager / Admin) */}
                {activeTab === 'operations' && (
                  <ManagerOperationsDashboard
                    currentUser={currentUser}
                    onOpenTicketModal={() => setIsTicketOpen(true)}
                    onOpenOutageModal={handleGuardedOpenOutage}
                    staffPermissions={staffPerms}
                  />
                )}

                {/* 3. Field Agent Dedicated Portal (Mobile Friendly) */}
                {activeTab === 'agent_portal' && (
                  <FieldAgentPortal
                    currentUser={currentUser}
                    gisPermission={staffPerms.gis_map}
                    staffPermissions={staffPerms}
                    onNavigateTab={(tab) => setActiveTab(tab)}
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleGuardedOpenPayment}
                  />
                )}

                {/* 4. Client / Subscriber Self-Service Portal */}
                {activeTab === 'client_portal' && (
                  <ClientSubscriberPortal
                    currentUser={currentUser}
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleOpenPayment}
                  />
                )}

                {/* MikroTik Fleet Studio (Gated by mikrotik_panel permission) */}
                {activeTab === 'mikrotik' && (
                  <div className="space-y-3">
                    {isAgent && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('agent_portal')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300 cursor-pointer transition"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back to Field Recovery Portal</span>
                      </button>
                    )}
                    <MikrotikStudio
                      onOpenProvisionModal={handleGuardedOpenProvision}
                      onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
                      staffPermissions={staffPerms}
                    />
                  </div>
                )}

                {/* VSOL OLT Studio (Gated by olt_panel permission) */}
                {activeTab === 'olt' && (
                  <div className="space-y-3">
                    {isAgent && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('agent_portal')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300 cursor-pointer transition"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back to Field Recovery Portal</span>
                      </button>
                    )}
                    <VsolOltStudio />
                  </div>
                )}

                {/* Full-Stack FTTH Fiber GIS, FOSC Joint Closure & Subscriber Map */}
                {activeTab === 'fiber_gis' && (
                  <div className="space-y-3">
                    {isAgent && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('agent_portal')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300 cursor-pointer transition"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back to Field Recovery Portal</span>
                      </button>
                    )}
                    <FiberGisMapView
                      currentUser={currentUser}
                      gisPermission={staffPerms.gis_map}
                      onReturnFromRestricted={() =>
                        setActiveTab(getLandingTabForRole(currentRole))
                      }
                    />
                  </div>
                )}

                {/* Multi-Tier Dealers & Sub-Dealers Reseller Console */}
                {activeTab === 'dealers' && (
                  <DealersManagementView
                    currentUser={currentUser}
                    currentRole={currentRole}
                  />
                )}

                {/* Multi-Tenant Baileys WhatsApp Gateway & Branding */}
                {activeTab === 'whatsapp_gateway' && (
                  <WhatsAppGatewayView
                    currentUser={currentUser}
                    currentRole={currentRole}
                  />
                )}

                {/* Billing & Invoices */}
                {activeTab === 'billing' && (
                  <BillingStudio
                    currentRole={currentRole}
                    currentUser={currentUser}
                    staffPermissions={staffPerms}
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleGuardedOpenPayment}
                  />
                )}

                {/* ISP Expense Tracker & Automated Net Profit Ledger */}
                {activeTab === 'profit_expenses' && (
                  <div className="space-y-3">
                    {isAgent && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('agent_portal')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-mono text-cyan-300 cursor-pointer transition"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        <span>Back to Field Recovery Portal</span>
                      </button>
                    )}
                    <ProfitLossLedgerView
                      currentUser={currentUser}
                      currentRole={currentRole}
                      staffPermissions={staffPerms}
                    />
                  </div>
                )}

                {/* Hardware Inventory, Sales & Vendor Payables ERP */}
                {activeTab === 'inventory' && <InventoryHardwareView />}

                {/* Complaints & SLA Ticketing */}
                {activeTab === 'complaints' && (
                  <ComplaintsStudio
                    onOpenTicketModal={() => setIsTicketOpen(true)}
                    onOpenOutageModal={handleGuardedOpenOutage}
                    staffPermissions={staffPerms}
                    currentUser={currentUser}
                  />
                )}

                {/* Mobile Simulator */}
                {activeTab === 'mobile' && (
                  <MobileAppSimulator
                    onOpenReceiptModal={handleOpenReceipt}
                    onOpenPaymentModal={handleOpenPayment}
                  />
                )}

                {/* User & Agent Hub */}
                {activeTab === 'users' && (
                  <UserManagementStudio
                    currentSimulatedRole={currentRole}
                    currentUser={currentUser}
                    onSwitchSimulatedRole={handleSwitchRole}
                  />
                )}

                {/* Granular Feature & Permission Management Matrix */}
                {activeTab === 'permissions' && (
                  <PermissionMatrixStudio
                    currentSimulatedRole={currentRole}
                    onSwitchSimulatedRole={handleSwitchRole}
                  />
                )}

                {/* Architecture & SQL */}
                {activeTab === 'architecture' && <ArchitectureStudio />}

                {/* Settings Studio */}
                {activeTab === 'settings' && <SettingsStudio />}

                {/* Activity & System Audit Logs */}
                {activeTab === 'logs' && <ActivityLogsStudio />}
              </>
            )}
          </div>
        </main>

        {/* Compact Footer Strip */}
        <footer className="border-t border-slate-200 dark:border-slate-800/80 bg-white/95 dark:bg-[#0B111E]/90 py-2.5 px-4 sm:px-6 text-[11px] text-slate-500 dark:text-slate-400 shrink-0 transition-colors duration-200">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 font-mono">
            {isClient ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Youth Net</span>
                  <span>&bull; Subscriber Self-Care Portal</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-3.5 h-3.5" /> 256-bit TLS Encrypted
                  </span>
                  <span>&bull;</span>
                  <span className="text-slate-500 dark:text-slate-400">24/7 Helpline: +92 51 111-968-846</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Radio className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                  <span className="text-slate-800 dark:text-slate-200 font-bold">Youth Net Carrier NOC v4.2</span>
                  <span>&bull; RBAC Tier [{currentRole}] Active</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-3 h-3" /> Secure Auth Active
                  </span>
                  <span>&bull;</span>
                  <span className="flex items-center gap-1 text-cyan-600 dark:text-cyan-400">
                    <Database className="w-3 h-3" /> PostgreSQL 16 `users` Table
                  </span>
                </div>
              </>
            )}
          </div>
        </footer>
      </div>

      {/* Global Modals (Guarded by strict RBAC) */}
      <ProvisionSecretModal
        isOpen={isProvisionOpen && staffPerms.provision_pppoe}
        onClose={() => setIsProvisionOpen(false)}
      />

      <OutageBroadcasterModal
        isOpen={isOutageOpen && staffPerms.outage_broadcast && !isClient}
        onClose={() => setIsOutageOpen(false)}
      />

      <NewTicketModal
        isOpen={isTicketOpen}
        onClose={() => setIsTicketOpen(false)}
      />

      <ReceiptModal
        invoice={selectedReceiptInvoice}
        onClose={() => setSelectedReceiptInvoice(null)}
      />

      <CashPaymentModal
        invoice={staffPerms.collect_fee || isClient ? selectedPaymentInvoice : null}
        onClose={() => setSelectedPaymentInvoice(null)}
        onPaymentSuccess={handlePaymentSuccess}
      />

      <AddMikrotikDeviceModal
        isOpen={isAddRouterOpen}
        onClose={() => setIsAddRouterOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <CurrencyProvider>
          <AuthProvider>
            <ISPProvider>
              <PermissionProvider>
                <ISPAppContent />
              </PermissionProvider>
            </ISPProvider>
          </AuthProvider>
        </CurrencyProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
