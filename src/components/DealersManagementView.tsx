import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Building2,
  Users,
  Wallet,
  Radio,
  Plus,
  ChevronRight,
  ChevronDown,
  Search,
  RefreshCw,
  ArrowRightLeft,
  SlidersHorizontal,
  BookOpen,
  X,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Database,
  Save,
  ShieldCheck,
  Gauge,
} from 'lucide-react';
import {
  supabase,
  SupabasePortalUser,
  SupabaseResellerTariff,
  SupabaseResellerWalletLedger,
  ResellerWalletTxType,
} from '../services/supabaseClient';
import { useISP } from '../context/ISPContext';
import { SystemRole, UserAccount } from '../types/auth';
import { fetchLiveMikrotikProfilesAndSecrets } from '../lib/billingAndNetwork';
import { isExpiryOrBlockedProfile } from '../lib/mikrotikProfileSync';
import {
  RESELLER_MIGRATION_SQL,
  RESELLER_WALLET_UPDATED_EVENT,
  ResellerTier,
  computeTariffMargin,
  createResellerAccount,
  fetchResellerDataBundle,
  getResellerTier,
  rechargeResellerWallet,
  transferDealerToSubDealer,
  updateResellerAccount,
  upsertResellerTariff,
} from '../lib/resellerEngine';

export interface DealersManagementViewProps {
  currentUser: UserAccount | null;
  currentRole: SystemRole;
}

const SYSTEM_IGNORED_PROFILES = new Set(['default', 'default-encryption']);

function formatRs(val: number | null | undefined): string {
  const n = Number(val) || 0;
  return `Rs. ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTxTypeLabel(txType: ResellerWalletTxType | string): {
  label: string;
  toneClass: string;
} {
  switch (txType) {
    case 'RECHARGE':
      return { label: 'Wallet Recharge', toneClass: 'text-emerald-600 dark:text-emerald-400' };
    case 'SUBDEALER_TRANSFER':
      return { label: 'Sub-Dealer Transfer', toneClass: 'text-sky-600 dark:text-sky-400' };
    case 'USER_ACTIVATION':
      return { label: 'User Activation', toneClass: 'text-amber-600 dark:text-amber-400' };
    case 'RENEWAL_DEDUCTION':
      return { label: 'Renewal Deduction', toneClass: 'text-indigo-600 dark:text-indigo-400' };
    case 'REFUND':
      return { label: 'Refund', toneClass: 'text-emerald-600 dark:text-emerald-400' };
    default:
      return { label: txType || 'Adjustment', toneClass: 'text-slate-600 dark:text-slate-400' };
  }
}

export const DealersManagementView: React.FC<DealersManagementViewProps> = ({
  currentUser,
  currentRole,
}) => {
  const { routers, selectedRouterId, activeSessions, packages } = useISP();
  const activeRouter = routers.find((r) => r.id === selectedRouterId) || routers[0];

  const isAdmin = currentRole === 'ADMIN';
  const currentTier = getResellerTier(currentUser);
  const isDealerSession = !isAdmin && currentTier === 'DEALER';

  const [activeSubTab, setActiveSubTab] = useState<'hierarchy' | 'ledger'>('hierarchy');
  const [dealers, setDealers] = useState<SupabasePortalUser[]>([]);
  const [subDealers, setSubDealers] = useState<SupabasePortalUser[]>([]);
  const [subscribers, setSubscribers] = useState<SupabasePortalUser[]>([]);
  const [tariffs, setTariffs] = useState<SupabaseResellerTariff[]>([]);
  const [ledger, setLedger] = useState<SupabaseResellerWalletLedger[]>([]);
  const [liveProfiles, setLiveProfiles] = useState<Array<{ name: string; rateLimit?: string }>>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState<boolean>(false);
  const [missingSchema, setMissingSchema] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  const [expandedDealerIds, setExpandedDealerIds] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [ledgerSearch, setLedgerSearch] = useState<string>('');
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<string>('ALL');
  const [ledgerResellerFilter, setLedgerResellerFilter] = useState<string>('ALL');

  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Create Dealer / Sub-Dealer Modal State
  const [createModalTier, setCreateModalTier] = useState<ResellerTier | null>(null);
  const [createForm, setCreateForm] = useState({
    fullName: '',
    username: '',
    password: '',
    phone: '',
    area: '',
    parentDealerId: '',
    creditLimit: '0',
    bandwidthPoolCapMbps: '100',
    maxActiveUsers: '100',
    initialWalletBalance: '0',
    canCreateSubdealers: true,
  });
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Recharge Wallet Modal State
  const [rechargeTarget, setRechargeTarget] = useState<SupabasePortalUser | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState<string>('');
  const [rechargeNotes, setRechargeNotes] = useState<string>('');
  const [isRecharging, setIsRecharging] = useState<boolean>(false);

  // Transfer Balance Modal State (Dealer -> Sub-Dealer)
  const [transferSourceDealer, setTransferSourceDealer] = useState<SupabasePortalUser | null>(null);
  const [transferTargetSubId, setTransferTargetSubId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<string>('');
  const [transferNotes, setTransferNotes] = useState<string>('');
  const [isTransferring, setIsTransferring] = useState<boolean>(false);

  // Drawer State (Wholesale Tariff Matrix + Profile/Caps Editor)
  const [drawerReseller, setDrawerReseller] = useState<SupabasePortalUser | null>(null);
  const [drawerTab, setDrawerTab] = useState<'tariffs' | 'settings'>('tariffs');
  const [tariffDrafts, setTariffDrafts] = useState<
    Record<string, { wholesale: string; retail: string }>
  >({});
  const [savingProfileName, setSavingProfileName] = useState<string | null>(null);
  const [isSavingAllTariffs, setIsSavingAllTariffs] = useState<boolean>(false);
  const [editCapsForm, setEditCapsForm] = useState({
    fullName: '',
    phone: '',
    area: '',
    creditLimit: '0',
    bandwidthPoolCapMbps: '0',
    maxActiveUsers: '0',
    canCreateSubdealers: false,
    accountStatus: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED',
    newPassword: '',
  });
  const [isSavingCaps, setIsSavingCaps] = useState<boolean>(false);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => {
      setNotice((prev) => (prev?.text === text ? null : prev));
    }, 6000);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const bundle = await fetchResellerDataBundle();
      setDealers(bundle.dealers);
      setSubDealers(bundle.subDealers);
      setSubscribers(bundle.subscribers);
      setTariffs(bundle.tariffs);
      setLedger(bundle.ledger);
      setMissingSchema(bundle.missingSchema);

      // Expand dealers by default on first load
      setExpandedDealerIds((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const next: Record<string, boolean> = {};
        bundle.dealers.forEach((d) => {
          next[d.id] = true;
        });
        return next;
      });
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to load reseller hierarchy.');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  const loadMikrotikProfiles = useCallback(async () => {
    setIsLoadingProfiles(true);
    try {
      const res = await fetchLiveMikrotikProfilesAndSecrets(activeRouter);
      if (res.ok && res.profiles.length > 0) {
        setLiveProfiles(res.profiles);
      } else if (packages && packages.length > 0) {
        setLiveProfiles(
          packages.map((p) => ({
            name: p.mikrotikProfile || p.name,
            rateLimit: p.downloadSpeedMbps
              ? `${p.uploadSpeedMbps || p.downloadSpeedMbps}M/${p.downloadSpeedMbps}M`
              : undefined,
          }))
        );
      }
    } catch {
      if (packages && packages.length > 0) {
        setLiveProfiles(
          packages.map((p) => ({
            name: p.mikrotikProfile || p.name,
            rateLimit: p.downloadSpeedMbps
              ? `${p.uploadSpeedMbps || p.downloadSpeedMbps}M/${p.downloadSpeedMbps}M`
              : undefined,
          }))
        );
      }
    } finally {
      setIsLoadingProfiles(false);
    }
  }, [activeRouter, packages]);

  useEffect(() => {
    void loadData();
    void loadMikrotikProfiles();

    const handleWalletEvent = () => {
      void loadData();
    };
    window.addEventListener(RESELLER_WALLET_UPDATED_EVENT, handleWalletEvent);

    const channel = supabase
      .channel('reseller_management_live_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'portal_users' }, () => {
        void loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reseller_wallet_ledger' }, () => {
        void loadData();
      })
      .subscribe();

    return () => {
      window.removeEventListener(RESELLER_WALLET_UPDATED_EVENT, handleWalletEvent);
      supabase.removeChannel(channel);
    };
  }, [loadData, loadMikrotikProfiles]);

  // Scope visible dealers/sub-dealers/ledger when logged in as a Dealer
  const visibleDealers = useMemo(() => {
    if (isAdmin) return dealers;
    if (isDealerSession && currentUser?.id) {
      return dealers.filter((d) => d.id === currentUser.id);
    }
    return [];
  }, [isAdmin, isDealerSession, currentUser?.id, dealers]);

  const visibleSubDealers = useMemo(() => {
    if (isAdmin) return subDealers;
    if (isDealerSession && currentUser?.id) {
      return subDealers.filter((s) => s.parent_dealer_id === currentUser.id);
    }
    return [];
  }, [isAdmin, isDealerSession, currentUser?.id, subDealers]);

  const visibleResellerIdSet = useMemo(() => {
    const set = new Set<string>();
    visibleDealers.forEach((d) => set.add(d.id));
    visibleSubDealers.forEach((s) => set.add(s.id));
    return set;
  }, [visibleDealers, visibleSubDealers]);

  const currentDealerRecord = useMemo(
    () => (isDealerSession && currentUser?.id ? dealers.find((d) => d.id === currentUser.id) || null : null),
    [isDealerSession, currentUser?.id, dealers]
  );

  const canCurrentUserCreateSubDealer =
    isAdmin || Boolean(currentDealerRecord?.can_create_subdealers || currentUser?.can_create_subdealers);

  // Live online PPPoE usernames from MikroTik
  const onlineUsernameSet = useMemo(() => {
    const set = new Set<string>();
    (activeSessions || []).forEach((s) => {
      const u = String(s.username || '').trim().toLowerCase();
      if (u) set.add(u);
    });
    return set;
  }, [activeSessions]);

  // Subscriber counts per reseller
  const subscriberStatsByReseller = useMemo(() => {
    const map = new Map<string, { total: number; active: number; online: number }>();
    for (const sub of subscribers) {
      const ownerId = sub.dealer_id || sub.parent_dealer_id || null;
      if (!ownerId) continue;
      const cur = map.get(ownerId) || { total: 0, active: 0, online: 0 };
      cur.total += 1;
      const isSuspended =
        Boolean(sub.is_suspended) ||
        String(sub.account_status || '').toUpperCase() === 'SUSPENDED' ||
        String(sub.billing_status || '').toUpperCase() === 'SUSPENDED_EXPIRED';
      if (!isSuspended) cur.active += 1;
      if (onlineUsernameSet.has(String(sub.username || '').trim().toLowerCase())) {
        cur.online += 1;
      }
      map.set(ownerId, cur);
    }
    return map;
  }, [subscribers, onlineUsernameSet]);

  // Top KPI Strip calculations
  const kpis = useMemo(() => {
    const activeDealersCount = visibleDealers.filter(
      (d) => String(d.account_status || 'ACTIVE').toUpperCase() !== 'SUSPENDED'
    ).length;
    const totalSubDealersCount = visibleSubDealers.length;
    const combinedFloat = [...visibleDealers, ...visibleSubDealers].reduce(
      (sum, r) => sum + (Number(r.wallet_balance) || 0),
      0
    );
    let totalResellerActiveUsers = 0;
    visibleResellerIdSet.forEach((rid) => {
      totalResellerActiveUsers += subscriberStatsByReseller.get(rid)?.active || 0;
    });

    return {
      activeDealersCount,
      totalSubDealersCount,
      combinedFloat,
      totalResellerActiveUsers,
    };
  }, [visibleDealers, visibleSubDealers, visibleResellerIdSet, subscriberStatsByReseller]);

  // Filtered hierarchy rows
  const cleanSearch = searchQuery.trim().toLowerCase();
  const subDealersByParent = useMemo(() => {
    const map = new Map<string, SupabasePortalUser[]>();
    visibleSubDealers.forEach((s) => {
      const pid = s.parent_dealer_id || '__unlinked__';
      const arr = map.get(pid) || [];
      arr.push(s);
      map.set(pid, arr);
    });
    return map;
  }, [visibleSubDealers]);

  const filteredDealers = useMemo(() => {
    if (!cleanSearch) return visibleDealers;
    return visibleDealers.filter((d) => {
      const selfMatches =
        (d.full_name || '').toLowerCase().includes(cleanSearch) ||
        (d.username || '').toLowerCase().includes(cleanSearch) ||
        (d.area || '').toLowerCase().includes(cleanSearch) ||
        (d.phone || '').toLowerCase().includes(cleanSearch);
      if (selfMatches) return true;
      const children = subDealersByParent.get(d.id) || [];
      return children.some(
        (c) =>
          (c.full_name || '').toLowerCase().includes(cleanSearch) ||
          (c.username || '').toLowerCase().includes(cleanSearch) ||
          (c.area || '').toLowerCase().includes(cleanSearch)
      );
    });
  }, [visibleDealers, cleanSearch, subDealersByParent]);

  const orphanSubDealers = useMemo(() => {
    const dealerIdSet = new Set(visibleDealers.map((d) => d.id));
    return visibleSubDealers.filter((s) => {
      if (s.parent_dealer_id && dealerIdSet.has(s.parent_dealer_id)) return false;
      if (!cleanSearch) return true;
      return (
        (s.full_name || '').toLowerCase().includes(cleanSearch) ||
        (s.username || '').toLowerCase().includes(cleanSearch) ||
        (s.area || '').toLowerCase().includes(cleanSearch)
      );
    });
  }, [visibleDealers, visibleSubDealers, cleanSearch]);

  // Filtered Wallet Transaction Ledger
  const filteredLedger = useMemo(() => {
    const q = ledgerSearch.trim().toLowerCase();
    return ledger.filter((row) => {
      if (!isAdmin && !visibleResellerIdSet.has(row.reseller_id)) return false;
      if (ledgerTypeFilter !== 'ALL' && row.tx_type !== ledgerTypeFilter) return false;
      if (ledgerResellerFilter !== 'ALL' && row.reseller_id !== ledgerResellerFilter) return false;
      if (!q) return true;
      return (
        String(row.reseller_name || '').toLowerCase().includes(q) ||
        String(row.reseller_username || '').toLowerCase().includes(q) ||
        String(row.subscriber_username || '').toLowerCase().includes(q) ||
        String(row.profile_name || '').toLowerCase().includes(q) ||
        String(row.notes || '').toLowerCase().includes(q)
      );
    });
  }, [ledger, isAdmin, visibleResellerIdSet, ledgerTypeFilter, ledgerResellerFilter, ledgerSearch]);

  // Open Create Modal
  const openCreateModal = (tier: ResellerTier, preselectedParentId?: string) => {
    setCreateModalTier(tier);
    setCreateForm({
      fullName: '',
      username: '',
      password: '',
      phone: '+92 3',
      area: currentDealerRecord?.area || '',
      parentDealerId:
        tier === 'SUB_DEALER'
          ? preselectedParentId || (isDealerSession ? currentUser?.id || '' : dealers[0]?.id || '')
          : '',
      creditLimit: '0',
      bandwidthPoolCapMbps: tier === 'DEALER' ? '200' : '50',
      maxActiveUsers: tier === 'DEALER' ? '200' : '50',
      initialWalletBalance: '0',
      canCreateSubdealers: tier === 'DEALER',
    });
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createModalTier) return;
    setIsCreating(true);
    try {
      const parentId =
        createModalTier === 'SUB_DEALER'
          ? isDealerSession
            ? currentUser?.id || null
            : createForm.parentDealerId || null
          : null;

      const res = await createResellerAccount({
        tierLevel: createModalTier,
        fullName: createForm.fullName,
        username: createForm.username,
        password: createForm.password,
        phone: createForm.phone,
        area: createForm.area,
        parentDealerId: parentId,
        creditLimit: Number(createForm.creditLimit) || 0,
        bandwidthPoolCapMbps: Number(createForm.bandwidthPoolCapMbps) || 0,
        maxActiveUsers: Number(createForm.maxActiveUsers) || 0,
        canCreateSubdealers: createModalTier === 'DEALER' ? createForm.canCreateSubdealers : false,
        initialWalletBalance: isAdmin ? Number(createForm.initialWalletBalance) || 0 : 0,
        performedBy: currentUser?.fullName || currentUser?.username || 'Admin',
      });

      if (!res.ok) {
        if (res.schemaMissing) setMissingSchema(true);
        showToast('error', res.error || 'Could not create reseller.');
        return;
      }

      setCreateModalTier(null);
      showToast(
        'success',
        `${createModalTier === 'DEALER' ? 'Master Dealer' : 'Sub-Dealer'} @${res.user?.username} created.`
      );
      await loadData();
    } finally {
      setIsCreating(false);
    }
  };

  // Recharge Wallet submit
  const handleRechargeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rechargeTarget) return;
    const amt = Number(rechargeAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('error', 'Enter a valid recharge amount greater than Rs. 0.');
      return;
    }

    setIsRecharging(true);
    try {
      const res = await rechargeResellerWallet({
        resellerId: rechargeTarget.id,
        amount: amt,
        performedBy: currentUser?.fullName || currentUser?.username || 'Admin',
        notes: rechargeNotes,
      });
      if (!res.ok) {
        if (res.schemaMissing) setMissingSchema(true);
        showToast('error', res.error || 'Wallet recharge failed.');
        return;
      }
      setRechargeTarget(null);
      setRechargeAmount('');
      setRechargeNotes('');
      showToast(
        'success',
        `Credited ${formatRs(amt)} to ${rechargeTarget.full_name}. New balance: ${formatRs(res.balanceAfter)}.`
      );
      await loadData();
    } finally {
      setIsRecharging(false);
    }
  };

  // Open Transfer Modal
  const openTransferModal = (sourceDealer: SupabasePortalUser, preselectedSubId?: string) => {
    const ownedSubs = subDealers.filter((s) => s.parent_dealer_id === sourceDealer.id);
    setTransferSourceDealer(sourceDealer);
    setTransferTargetSubId(preselectedSubId || ownedSubs[0]?.id || '');
    setTransferAmount('');
    setTransferNotes('');
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferSourceDealer || !transferTargetSubId) {
      showToast('error', 'Select a destination Sub-Dealer.');
      return;
    }
    const amt = Number(transferAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('error', 'Enter a valid transfer amount greater than Rs. 0.');
      return;
    }

    setIsTransferring(true);
    try {
      const res = await transferDealerToSubDealer({
        fromDealerId: transferSourceDealer.id,
        toSubDealerId: transferTargetSubId,
        amount: amt,
        performedBy: currentUser?.fullName || currentUser?.username || 'Dealer',
        isAdminOverride: isAdmin,
        notes: transferNotes,
      });

      if (!res.ok) {
        showToast('error', res.error || 'Balance transfer failed.');
        return;
      }
      setTransferSourceDealer(null);
      setTransferAmount('');
      setTransferNotes('');
      showToast(
        'success',
        `Transferred ${formatRs(amt)} to Sub-Dealer. Remaining Dealer balance: ${formatRs(res.dealerBalanceAfter)}.`
      );
      await loadData();
    } finally {
      setIsTransferring(false);
    }
  };

  // Open Tariff & Profile Drawer
  const openResellerDrawer = (reseller: SupabasePortalUser, initialTab: 'tariffs' | 'settings' = 'tariffs') => {
    setDrawerReseller(reseller);
    setDrawerTab(initialTab);
    setEditCapsForm({
      fullName: reseller.full_name || '',
      phone: reseller.phone || '',
      area: reseller.area || '',
      creditLimit: String(Number(reseller.credit_limit || 0)),
      bandwidthPoolCapMbps: String(Number(reseller.bandwidth_pool_cap_mbps || 0)),
      maxActiveUsers: String(Number(reseller.max_active_users || 0)),
      canCreateSubdealers: Boolean(reseller.can_create_subdealers),
      accountStatus:
        String(reseller.account_status || 'ACTIVE').toUpperCase() === 'SUSPENDED'
          ? 'SUSPENDED'
          : 'ACTIVE',
      newPassword: '',
    });

    const existingForReseller = tariffs.filter((t) => t.reseller_id === reseller.id);
    const drafts: Record<string, { wholesale: string; retail: string }> = {};
    existingForReseller.forEach((t) => {
      drafts[t.profile_name] = {
        wholesale: String(Number(t.wholesale_price || 0)),
        retail: String(Number(t.retail_price || 0)),
      };
    });
    setTariffDrafts(drafts);
  };

  // Combined live MikroTik profiles + any saved tariff profile names for the open drawer
  const drawerProfileRows = useMemo(() => {
    if (!drawerReseller) return [];
    const map = new Map<string, { name: string; rateLimit?: string }>();
    liveProfiles.forEach((p) => {
      const clean = p.name.trim();
      if (!clean) return;
      if (SYSTEM_IGNORED_PROFILES.has(clean.toLowerCase())) return;
      if (isExpiryOrBlockedProfile(clean)) return;
      map.set(clean.toLowerCase(), { name: clean, rateLimit: p.rateLimit });
    });
    tariffs
      .filter((t) => t.reseller_id === drawerReseller.id)
      .forEach((t) => {
        const key = t.profile_name.trim().toLowerCase();
        if (!map.has(key)) {
          map.set(key, { name: t.profile_name.trim() });
        }
      });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [drawerReseller, liveProfiles, tariffs]);

  const canEditDrawerReseller = useMemo(() => {
    if (!drawerReseller) return false;
    if (isAdmin) return true;
    // Parent Dealer can edit tariffs/caps for their own Sub-Dealers (not their own wholesale cost)
    if (isDealerSession && drawerReseller.parent_dealer_id === currentUser?.id) {
      return true;
    }
    return false;
  }, [drawerReseller, isAdmin, isDealerSession, currentUser?.id]);

  const handleSaveSingleTariff = async (profileName: string) => {
    if (!drawerReseller || !canEditDrawerReseller) return;
    const draft = tariffDrafts[profileName] || { wholesale: '0', retail: '0' };
    setSavingProfileName(profileName);
    try {
      const res = await upsertResellerTariff({
        resellerId: drawerReseller.id,
        profileName,
        wholesalePrice: Number(draft.wholesale) || 0,
        retailPrice: Number(draft.retail) || 0,
        updatedBy: currentUser?.fullName || currentUser?.username || 'Admin',
      });
      if (!res.ok) {
        if (res.schemaMissing) setMissingSchema(true);
        showToast('error', res.error || 'Failed to save tariff.');
        return;
      }
      showToast('success', `Saved tariff for "${profileName}".`);
      await loadData();
    } finally {
      setSavingProfileName(null);
    }
  };

  const handleSaveAllTariffs = async () => {
    if (!drawerReseller || !canEditDrawerReseller) return;
    setIsSavingAllTariffs(true);
    try {
      let savedCount = 0;
      for (const row of drawerProfileRows) {
        const draft = tariffDrafts[row.name];
        if (!draft) continue;
        const res = await upsertResellerTariff({
          resellerId: drawerReseller.id,
          profileName: row.name,
          wholesalePrice: Number(draft.wholesale) || 0,
          retailPrice: Number(draft.retail) || 0,
          updatedBy: currentUser?.fullName || currentUser?.username || 'Admin',
        });
        if (!res.ok) {
          if (res.schemaMissing) setMissingSchema(true);
          showToast('error', res.error || `Failed saving tariff for ${row.name}.`);
          return;
        }
        savedCount += 1;
      }
      showToast('success', `Saved ${savedCount} package tariff${savedCount === 1 ? '' : 's'} for ${drawerReseller.full_name}.`);
      await loadData();
    } finally {
      setIsSavingAllTariffs(false);
    }
  };

  const handleSaveCapsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawerReseller || !canEditDrawerReseller) return;
    setIsSavingCaps(true);
    try {
      const res = await updateResellerAccount(drawerReseller.id, {
        fullName: editCapsForm.fullName,
        phone: editCapsForm.phone,
        area: editCapsForm.area,
        creditLimit: Number(editCapsForm.creditLimit) || 0,
        bandwidthPoolCapMbps: Number(editCapsForm.bandwidthPoolCapMbps) || 0,
        maxActiveUsers: Number(editCapsForm.maxActiveUsers) || 0,
        canCreateSubdealers:
          getResellerTier(drawerReseller) === 'DEALER' ? editCapsForm.canCreateSubdealers : false,
        accountStatus: editCapsForm.accountStatus,
        password: editCapsForm.newPassword || undefined,
      });
      if (!res.ok) {
        showToast('error', res.error || 'Failed to save reseller settings.');
        return;
      }
      showToast('success', `Updated settings for ${editCapsForm.fullName}.`);
      await loadData();
      setDrawerReseller((prev) =>
        prev
          ? {
              ...prev,
              full_name: editCapsForm.fullName,
              phone: editCapsForm.phone,
              area: editCapsForm.area,
              credit_limit: Number(editCapsForm.creditLimit) || 0,
              bandwidth_pool_cap_mbps: Number(editCapsForm.bandwidthPoolCapMbps) || 0,
              max_active_users: Number(editCapsForm.maxActiveUsers) || 0,
              can_create_subdealers:
                getResellerTier(prev) === 'DEALER' ? editCapsForm.canCreateSubdealers : false,
              account_status: editCapsForm.accountStatus,
            }
          : null
      );
      setEditCapsForm((prev) => ({ ...prev, newPassword: '' }));
    } finally {
      setIsSavingCaps(false);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard?.writeText(RESELLER_MIGRATION_SQL);
    setCopiedSql(true);
    window.setTimeout(() => setCopiedSql(false), 3000);
  };

  return (
    <div className="space-y-5">
      {/* Page Header & Primary Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Dealers &amp; Sub-Dealers
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isAdmin
              ? 'Master ISP multi-tier reseller hierarchy · Wholesale MikroTik tariffs · Prepaid wallet float & ledger'
              : 'Dealer reseller console · Manage linked Sub-Dealers, wholesale tariffs, and prepaid wallet balance'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              void loadData();
              void loadMikrotikProfiles();
            }}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {canCurrentUserCreateSubDealer && (
            <button
              type="button"
              onClick={() => openCreateModal('SUB_DEALER')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-sky-600/40 bg-sky-50 dark:bg-sky-950/50 text-xs font-medium text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Sub-Dealer</span>
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              onClick={() => openCreateModal('DEALER')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold transition whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Dealer</span>
            </button>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {notice && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-xs font-medium ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
          role="status"
        >
          <div className="flex items-center gap-2 min-w-0">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Missing Schema SQL Migration Notice */}
      {missingSchema && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <Database className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 dark:text-amber-100">
              <p className="font-semibold">Reseller Database Tables Required</p>
              <p className="text-amber-700 dark:text-amber-300 mt-0.5">
                Run the idempotent SQL migration in Supabase SQL Editor to create{' '}
                <code className="font-mono">reseller_tariffs</code>,{' '}
                <code className="font-mono">reseller_wallet_ledger</code>, and reseller columns on{' '}
                <code className="font-mono">portal_users</code>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopySql}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSql ? 'SQL Copied' : 'Copy Reseller SQL'}</span>
          </button>
        </div>
      )}

      {/* Top KPI Strip (4 Single-Elevation Flat Cards, Tabular Numerals) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Active Dealers</span>
            <Building2 className="w-4 h-4 text-cyan-500" />
          </div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {kpis.activeDealersCount.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {visibleDealers.length} registered master tier
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Sub-Dealers</span>
            <Users className="w-4 h-4 text-sky-500" />
          </div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {kpis.totalSubDealersCount.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Linked under parent dealers
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Combined Reseller Wallet Float</span>
            <Wallet className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
            {formatRs(kpis.combinedFloat)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Prepaid float across all tiers
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Reseller Active PPPoE Users</span>
            <Radio className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-100">
            {kpis.totalResellerActiveUsers.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Non-suspended reseller subscribers
          </div>
        </div>
      </div>

      {/* Sub-Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveSubTab('hierarchy')}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'hierarchy'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Dealer &amp; Sub-Dealer Tree
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('ledger')}
            className={`px-3.5 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer whitespace-nowrap ${
              activeSubTab === 'ledger'
                ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              Wallet Transaction Ledger ({filteredLedger.length})
            </span>
          </button>
        </div>

        {activeSubTab === 'hierarchy' && (
          <div className="relative pb-2 sm:pb-1.5 w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search dealer, username, area..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-cyan-500"
            />
          </div>
        )}
      </div>

      {/* TAB 1: HIERARCHICAL DEALER & SUB-DEALER TREE TABLE */}
      {activeSubTab === 'hierarchy' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-4 font-semibold">Reseller Hierarchy</th>
                  <th className="py-3 px-3 font-semibold">Area / Contact</th>
                  <th className="py-3 px-3 font-semibold text-right">Wallet Balance</th>
                  <th className="py-3 px-3 font-semibold text-right">Credit Limit</th>
                  <th className="py-3 px-3 font-semibold text-right">BW Cap / Users</th>
                  <th className="py-3 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">
                      Loading live reseller hierarchy from Supabase...
                    </td>
                  </tr>
                ) : filteredDealers.length === 0 && orphanSubDealers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center">
                      <Building2 className="w-7 h-7 text-slate-400 mx-auto mb-2" />
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        No Dealers or Sub-Dealers Found
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {isAdmin
                          ? 'Click "Create Dealer" to onboard your first wholesale reseller.'
                          : 'No sub-dealers are linked under your account yet.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  <>
                    {filteredDealers.map((dealer) => {
                      const children = (subDealersByParent.get(dealer.id) || []).filter((c) => {
                        if (!cleanSearch) return true;
                        const parentMatches =
                          (dealer.full_name || '').toLowerCase().includes(cleanSearch) ||
                          (dealer.username || '').toLowerCase().includes(cleanSearch);
                        if (parentMatches) return true;
                        return (
                          (c.full_name || '').toLowerCase().includes(cleanSearch) ||
                          (c.username || '').toLowerCase().includes(cleanSearch) ||
                          (c.area || '').toLowerCase().includes(cleanSearch)
                        );
                      });
                      const isExpanded = expandedDealerIds[dealer.id] !== false;
                      const stats = subscriberStatsByReseller.get(dealer.id) || {
                        total: 0,
                        active: 0,
                        online: 0,
                      };
                      const childActiveSum = children.reduce(
                        (s, c) => s + (subscriberStatsByReseller.get(c.id)?.active || 0),
                        0
                      );
                      const isSuspended =
                        String(dealer.account_status || 'ACTIVE').toUpperCase() === 'SUSPENDED';

                      return (
                        <React.Fragment key={dealer.id}>
                          {/* Master Dealer Row */}
                          <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition">
                            <td className="py-3.5 px-4">
                              <div className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedDealerIds((prev) => ({
                                      ...prev,
                                      [dealer.id]: !isExpanded,
                                    }))
                                  }
                                  className="mt-0.5 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 cursor-pointer"
                                  title={isExpanded ? 'Collapse Sub-Dealers' : 'Expand Sub-Dealers'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                                      {dealer.full_name}
                                    </span>
                                    <span className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">
                                      DEALER
                                    </span>
                                    {isSuspended && (
                                      <span className="text-[11px] font-mono text-rose-500">
                                        SUSPENDED
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                    @{dealer.username} · {children.length} sub-dealer
                                    {children.length === 1 ? '' : 's'}
                                    {dealer.can_create_subdealers ? ' · Can create sub-dealers' : ''}
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5 px-3 text-slate-600 dark:text-slate-300">
                              <div>{dealer.area || '—'}</div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                {dealer.phone || '—'}
                              </div>
                            </td>

                            <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                              <div
                                className={`font-semibold ${
                                  Number(dealer.wallet_balance || 0) < 0
                                    ? 'text-rose-500'
                                    : 'text-emerald-600 dark:text-emerald-400'
                                }`}
                              >
                                {formatRs(dealer.wallet_balance)}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                Avail: {formatRs((Number(dealer.wallet_balance) || 0) + (Number(dealer.credit_limit) || 0))}
                              </div>
                            </td>

                            <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              {formatRs(dealer.credit_limit)}
                            </td>

                            <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                              <div>
                                {Number(dealer.bandwidth_pool_cap_mbps || 0) > 0
                                  ? `${dealer.bandwidth_pool_cap_mbps} Mbps`
                                  : 'Unmetered'}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                {stats.active}
                                {childActiveSum > 0 ? ` (+${childActiveSum} sub)` : ''} /{' '}
                                {Number(dealer.max_active_users || 0) > 0
                                  ? dealer.max_active_users
                                  : '∞'}{' '}
                                users
                              </div>
                            </td>

                            <td className="py-3.5 px-4 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRechargeTarget(dealer);
                                      setRechargeAmount('');
                                      setRechargeNotes('');
                                    }}
                                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition whitespace-nowrap cursor-pointer"
                                  >
                                    Recharge Wallet
                                  </button>
                                )}

                                {children.length > 0 && (isAdmin || dealer.id === currentUser?.id) && (
                                  <button
                                    type="button"
                                    onClick={() => openTransferModal(dealer)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-500/40 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
                                  >
                                    <ArrowRightLeft className="w-3 h-3" />
                                    <span>Transfer</span>
                                  </button>
                                )}

                                {(isAdmin || (dealer.id === currentUser?.id && dealer.can_create_subdealers)) && (
                                  <button
                                    type="button"
                                    onClick={() => openCreateModal('SUB_DEALER', dealer.id)}
                                    className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
                                  >
                                    + Sub-Dealer
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => openResellerDrawer(dealer, 'tariffs')}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
                                >
                                  <SlidersHorizontal className="w-3 h-3" />
                                  <span>Tariffs</span>
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Nested Sub-Dealer Rows */}
                          {isExpanded &&
                            children.map((sub) => {
                              const subStats = subscriberStatsByReseller.get(sub.id) || {
                                total: 0,
                                active: 0,
                                online: 0,
                              };
                              const subSuspended =
                                String(sub.account_status || 'ACTIVE').toUpperCase() === 'SUSPENDED';

                              return (
                                <tr
                                  key={sub.id}
                                  className="bg-slate-50/50 dark:bg-slate-950/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/30 transition"
                                >
                                  <td className="py-3 pl-12 pr-4">
                                    <div className="border-l-2 border-slate-300 dark:border-slate-700 pl-3">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-slate-800 dark:text-slate-200">
                                          {sub.full_name}
                                        </span>
                                        <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400">
                                          SUB-DEALER
                                        </span>
                                        {subSuspended && (
                                          <span className="text-[10px] font-mono text-rose-500">
                                            SUSPENDED
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                        @{sub.username} · Parent: @{dealer.username}
                                      </div>
                                    </div>
                                  </td>

                                  <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                                    <div>{sub.area || '—'}</div>
                                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                                      {sub.phone || '—'}
                                    </div>
                                  </td>

                                  <td className="py-3 px-3 text-right font-mono tabular-nums">
                                    <div
                                      className={`font-semibold ${
                                        Number(sub.wallet_balance || 0) < 0
                                          ? 'text-rose-500'
                                          : 'text-emerald-600 dark:text-emerald-400'
                                      }`}
                                    >
                                      {formatRs(sub.wallet_balance)}
                                    </div>
                                  </td>

                                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                    {formatRs(sub.credit_limit)}
                                  </td>

                                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                    <div>
                                      {Number(sub.bandwidth_pool_cap_mbps || 0) > 0
                                        ? `${sub.bandwidth_pool_cap_mbps} Mbps`
                                        : 'Unmetered'}
                                    </div>
                                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                                      {subStats.active} /{' '}
                                      {Number(sub.max_active_users || 0) > 0
                                        ? sub.max_active_users
                                        : '∞'}{' '}
                                      users
                                    </div>
                                  </td>

                                  <td className="py-3 px-4 text-right">
                                    <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                                      {isAdmin && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setRechargeTarget(sub);
                                            setRechargeAmount('');
                                            setRechargeNotes('');
                                          }}
                                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition whitespace-nowrap cursor-pointer"
                                        >
                                          Recharge Wallet
                                        </button>
                                      )}

                                      {(isAdmin || dealer.id === currentUser?.id) && (
                                        <button
                                          type="button"
                                          onClick={() => openTransferModal(dealer, sub.id)}
                                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-sky-500/40 bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
                                        >
                                          <ArrowRightLeft className="w-3 h-3" />
                                          <span>Send Float</span>
                                        </button>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => openResellerDrawer(sub, 'tariffs')}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-medium transition whitespace-nowrap cursor-pointer"
                                      >
                                        <SlidersHorizontal className="w-3 h-3" />
                                        <span>Tariffs</span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })}

                    {/* Unlinked Sub-Dealers (if any) */}
                    {orphanSubDealers.map((sub) => {
                      const subStats = subscriberStatsByReseller.get(sub.id) || {
                        total: 0,
                        active: 0,
                        online: 0,
                      };
                      return (
                        <tr key={sub.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {sub.full_name}{' '}
                              <span className="text-[10px] font-mono text-sky-500 ml-1">
                                SUB-DEALER (UNLINKED)
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">@{sub.username}</div>
                          </td>
                          <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                            {sub.area || '—'} · {sub.phone || '—'}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-500 font-semibold">
                            {formatRs(sub.wallet_balance)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                            {formatRs(sub.credit_limit)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-500">
                            {subStats.active} / {sub.max_active_users || '∞'} users
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRechargeTarget(sub);
                                    setRechargeAmount('');
                                    setRechargeNotes('');
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer"
                                >
                                  Recharge Wallet
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openResellerDrawer(sub, 'tariffs')}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-medium cursor-pointer"
                              >
                                Tariffs
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: WALLET TRANSACTION LEDGER */}
      {activeSubTab === 'ledger' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
                placeholder="Search reseller, subscriber, profile, notes..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <select
              value={ledgerResellerFilter}
              onChange={(e) => setLedgerResellerFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">All Resellers</option>
              {visibleDealers.map((d) => (
                <option key={d.id} value={d.id}>
                  [Dealer] {d.full_name} (@{d.username})
                </option>
              ))}
              {visibleSubDealers.map((s) => (
                <option key={s.id} value={s.id}>
                  [Sub-Dealer] {s.full_name} (@{s.username})
                </option>
              ))}
            </select>

            <select
              value={ledgerTypeFilter}
              onChange={(e) => setLedgerTypeFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">All Transaction Types</option>
              <option value="RECHARGE">RECHARGE</option>
              <option value="SUBDEALER_TRANSFER">SUBDEALER_TRANSFER</option>
              <option value="USER_ACTIVATION">USER_ACTIVATION</option>
              <option value="RENEWAL_DEDUCTION">RENEWAL_DEDUCTION</option>
              <option value="REFUND">REFUND</option>
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-3 px-4 font-semibold">Date</th>
                    <th className="py-3 px-3 font-semibold">Reseller</th>
                    <th className="py-3 px-3 font-semibold">Type</th>
                    <th className="py-3 px-3 font-semibold text-right">Amount</th>
                    <th className="py-3 px-3 font-semibold text-right">Balance After</th>
                    <th className="py-3 px-4 font-semibold">Subscriber / Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                  {filteredLedger.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500 dark:text-slate-400">
                        No wallet ledger transactions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    filteredLedger.map((entry) => {
                      const meta = formatTxTypeLabel(entry.tx_type);
                      const amt = Number(entry.amount) || 0;
                      const isCredit = amt >= 0;
                      return (
                        <tr
                          key={entry.id}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition"
                        >
                          <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {formatDateTime(entry.created_at)}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {entry.reseller_name || '—'}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              @{entry.reseller_username || 'reseller'}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span className={`font-semibold text-[11px] ${meta.toneClass}`}>
                              {meta.label}
                            </span>
                            <div className="text-[10px] font-mono text-slate-500">{entry.tx_type}</div>
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                              isCredit
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {isCredit ? '+' : '-'}
                            {formatRs(Math.abs(amt))}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatRs(entry.balance_after)}
                          </td>
                          <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                            {entry.subscriber_username && (
                              <span className="font-mono text-cyan-600 dark:text-cyan-400 mr-1.5">
                                @{entry.subscriber_username}
                                {entry.profile_name ? ` (${entry.profile_name})` : ''}
                              </span>
                            )}
                            <span>{entry.notes || '—'}</span>
                            {entry.performed_by && (
                              <span className="text-[11px] text-slate-400 ml-1.5">
                                · by {entry.performed_by}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CREATE DEALER / CREATE SUB-DEALER */}
      {createModalTier && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {createModalTier === 'DEALER' ? 'Create Master Dealer' : 'Create Sub-Dealer'}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Provisions login credentials, wallet balance, and bandwidth/user caps in Supabase
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalTier(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Full Name / Franchise Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.fullName}
                    onChange={(e) => setCreateForm((p) => ({ ...p, fullName: e.target.value }))}
                    placeholder="e.g. Saddar Fiber Network"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Phone Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.phone}
                    onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+92 300 1234567"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Login Username *
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.username}
                    onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
                    placeholder="e.g. dealer_saddar"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Login Password *
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.password}
                    onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="Portal password"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Area / Coverage Zone
                  </label>
                  <input
                    type="text"
                    value={createForm.area}
                    onChange={(e) => setCreateForm((p) => ({ ...p, area: e.target.value }))}
                    placeholder="e.g. Baza Mohallah / Saddar"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {createModalTier === 'SUB_DEALER' ? (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Parent Dealer *
                    </label>
                    <select
                      required
                      disabled={isDealerSession}
                      value={createForm.parentDealerId}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, parentDealerId: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 disabled:opacity-70"
                    >
                      <option value="">Select Parent Dealer</option>
                      {visibleDealers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name} (@{d.username})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Opening Wallet Balance (Rs.)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={createForm.initialWalletBalance}
                      onChange={(e) =>
                        setCreateForm((p) => ({ ...p, initialWalletBalance: e.target.value }))
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Credit Limit (Rs.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={createForm.creditLimit}
                    onChange={(e) => setCreateForm((p) => ({ ...p, creditLimit: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Bandwidth Cap (Mbps)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={createForm.bandwidthPoolCapMbps}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, bandwidthPoolCapMbps: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Max Active Users Cap
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={createForm.maxActiveUsers}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, maxActiveUsers: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              {createModalTier === 'DEALER' && (
                <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3.5 py-2.5 cursor-pointer">
                  <div>
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      Allow Creating Sub-Dealers
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Grants this Dealer permission to onboard and fund their own Sub-Dealers
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={createForm.canCreateSubdealers}
                    onChange={(e) =>
                      setCreateForm((p) => ({ ...p, canCreateSubdealers: e.target.checked }))
                    }
                    className="w-4 h-4 accent-cyan-500"
                  />
                </label>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setCreateModalTier(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-semibold cursor-pointer"
                >
                  {isCreating
                    ? 'Creating...'
                    : createModalTier === 'DEALER'
                    ? 'Create Master Dealer'
                    : 'Create Sub-Dealer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: RECHARGE WALLET (ADMIN -> DEALER / SUB-DEALER) */}
      {rechargeTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Recharge Reseller Wallet
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {rechargeTarget.full_name} (@{rechargeTarget.username}) · Current:{' '}
                  <span className="font-mono text-emerald-500">
                    {formatRs(rechargeTarget.wallet_balance)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRechargeTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRechargeSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Recharge Amount (Rs.) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="1"
                  autoFocus
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                  placeholder="e.g. 25000"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base font-mono font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                />
                <div className="flex items-center gap-1.5 mt-2">
                  {[5000, 10000, 25000, 50000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setRechargeAmount(String(preset))}
                      className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:border-emerald-500 cursor-pointer"
                    >
                      +{preset.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Reference / Payment Mode Note
                </label>
                <input
                  type="text"
                  value={rechargeNotes}
                  onChange={(e) => setRechargeNotes(e.target.value)}
                  placeholder="e.g. Cash received at NOC / Bank IBFT #4921"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3.5 py-2.5 flex items-center justify-between font-mono">
                <span className="text-slate-500 dark:text-slate-400">Projected Balance</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatRs((Number(rechargeTarget.wallet_balance) || 0) + (Number(rechargeAmount) || 0))}
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRechargeTarget(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRecharging}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-semibold cursor-pointer"
                >
                  {isRecharging ? 'Crediting...' : 'Confirm Recharge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: DEALER -> SUB-DEALER BALANCE TRANSFER */}
      {transferSourceDealer && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Transfer Balance to Sub-Dealer
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  From {transferSourceDealer.full_name} · Wallet:{' '}
                  <span className="font-mono text-emerald-500">
                    {formatRs(transferSourceDealer.wallet_balance)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTransferSourceDealer(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleTransferSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Destination Sub-Dealer *
                </label>
                <select
                  required
                  value={transferTargetSubId}
                  onChange={(e) => setTransferTargetSubId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="">Select Sub-Dealer</option>
                  {subDealers
                    .filter((s) => s.parent_dealer_id === transferSourceDealer.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name} (@{s.username}) — Bal: {formatRs(s.wallet_balance)}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Transfer Amount (Rs.) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max={Math.max(0, Number(transferSourceDealer.wallet_balance || 0))}
                  step="1"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="Enter amount to transfer"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base font-mono font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Transfer Note
                </label>
                <input
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="Optional reference note"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferSourceDealer(null)}
                  className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTransferring}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold cursor-pointer"
                >
                  {isTransferring ? 'Transferring...' : 'Execute Atomic Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SLIDE-OVER DRAWER: WHOLESALE PACKAGE TARIFF MATRIX & PROFILE CAPS */}
      {drawerReseller && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-2xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {drawerReseller.full_name}
                  </h2>
                  <span className="text-[11px] font-mono text-cyan-600 dark:text-cyan-400">
                    {getResellerTier(drawerReseller) === 'DEALER' ? 'MASTER DEALER' : 'SUB-DEALER'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  @{drawerReseller.username} · Wallet {formatRs(drawerReseller.wallet_balance)} · Credit{' '}
                  {formatRs(drawerReseller.credit_limit)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerReseller(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Tabs */}
            <div className="flex items-center justify-between px-5 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDrawerTab('tariffs')}
                  className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
                    drawerTab === 'tariffs'
                      ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Wholesale Package Tariff Matrix ({drawerProfileRows.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('settings')}
                  className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
                    drawerTab === 'settings'
                      ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Limits &amp; Account Profile
                </button>
              </div>

              {drawerTab === 'tariffs' && canEditDrawerReseller && drawerProfileRows.length > 0 && (
                <button
                  type="button"
                  onClick={handleSaveAllTariffs}
                  disabled={isSavingAllTariffs}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white text-xs font-semibold cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSavingAllTariffs ? 'Saving...' : 'Save All Tariffs'}</span>
                </button>
              )}
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {drawerTab === 'tariffs' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      Loaded live from MikroTik <code className="font-mono">/ppp/profile</code>.
                      Wholesale Cost is auto-deducted on PPPoE activation &amp; monthly renewal.
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadMikrotikProfiles()}
                      className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400 hover:underline whitespace-nowrap ml-3 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingProfiles ? 'animate-spin' : ''}`} />
                      <span>Sync Profiles</span>
                    </button>
                  </div>

                  {!canEditDrawerReseller && (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-cyan-500 shrink-0" />
                      <span>
                        Read-only tariff view. Wholesale rates for your own account are managed by Master ISP Admin.
                      </span>
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          <th className="py-2.5 px-3 font-semibold">MikroTik PPPoE Profile</th>
                          <th className="py-2.5 px-3 font-semibold">Wholesale Cost (Rs.)</th>
                          <th className="py-2.5 px-3 font-semibold">Retail Price (Rs.)</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Margin</th>
                          {canEditDrawerReseller && <th className="py-2.5 px-3 font-semibold text-right">Save</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                        {drawerProfileRows.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-slate-500">
                              No MikroTik PPPoE profiles loaded. Connect a RouterOS device or click Sync Profiles.
                            </td>
                          </tr>
                        ) : (
                          drawerProfileRows.map((prof) => {
                            const draft = tariffDrafts[prof.name] || { wholesale: '0', retail: '0' };
                            const { marginRs, marginPct } = computeTariffMargin(
                              Number(draft.wholesale) || 0,
                              Number(draft.retail) || 0
                            );

                            return (
                              <tr key={prof.name} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                                <td className="py-2.5 px-3">
                                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                                    {prof.name}
                                  </div>
                                  {prof.rateLimit && (
                                    <div className="text-[10px] font-mono text-slate-500">
                                      Rate: {prof.rateLimit}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="number"
                                    min="0"
                                    disabled={!canEditDrawerReseller}
                                    value={draft.wholesale}
                                    onChange={(e) =>
                                      setTariffDrafts((prev) => ({
                                        ...prev,
                                        [prof.name]: {
                                          wholesale: e.target.value,
                                          retail: prev[prof.name]?.retail ?? '0',
                                        },
                                      }))
                                    }
                                    className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 disabled:opacity-60"
                                  />
                                </td>
                                <td className="py-2.5 px-3">
                                  <input
                                    type="number"
                                    min="0"
                                    disabled={!canEditDrawerReseller}
                                    value={draft.retail}
                                    onChange={(e) =>
                                      setTariffDrafts((prev) => ({
                                        ...prev,
                                        [prof.name]: {
                                          wholesale: prev[prof.name]?.wholesale ?? '0',
                                          retail: e.target.value,
                                        },
                                      }))
                                    }
                                    className="w-28 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono tabular-nums text-slate-900 dark:text-slate-100 focus:outline-none focus:border-cyan-500 disabled:opacity-60"
                                  />
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                  <span
                                    className={
                                      marginRs >= 0
                                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                        : 'text-rose-500 font-semibold'
                                    }
                                  >
                                    {marginRs >= 0 ? '+' : ''}
                                    {marginRs.toLocaleString()} ({marginPct}%)
                                  </span>
                                </td>
                                {canEditDrawerReseller && (
                                  <td className="py-2.5 px-3 text-right">
                                    <button
                                      type="button"
                                      disabled={savingProfileName === prof.name}
                                      onClick={() => void handleSaveSingleTariff(prof.name)}
                                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-cyan-600 text-slate-100 text-[11px] font-medium transition cursor-pointer disabled:opacity-50"
                                    >
                                      {savingProfileName === prof.name ? '...' : 'Save'}
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSaveCapsSubmit} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Name / Franchise
                      </label>
                      <input
                        type="text"
                        disabled={!canEditDrawerReseller}
                        value={editCapsForm.fullName}
                        onChange={(e) => setEditCapsForm((p) => ({ ...p, fullName: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Phone
                      </label>
                      <input
                        type="text"
                        disabled={!canEditDrawerReseller}
                        value={editCapsForm.phone}
                        onChange={(e) => setEditCapsForm((p) => ({ ...p, phone: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-mono disabled:opacity-60"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Area / Zone
                      </label>
                      <input
                        type="text"
                        disabled={!canEditDrawerReseller}
                        value={editCapsForm.area}
                        onChange={(e) => setEditCapsForm((p) => ({ ...p, area: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Account Status
                      </label>
                      <select
                        disabled={!canEditDrawerReseller}
                        value={editCapsForm.accountStatus}
                        onChange={(e) =>
                          setEditCapsForm((p) => ({
                            ...p,
                            accountStatus: e.target.value as 'ACTIVE' | 'SUSPENDED',
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      >
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Credit Limit (Rs.)
                      </label>
                      <input
                        type="number"
                        min="0"
                        disabled={!canEditDrawerReseller}
                        value={editCapsForm.creditLimit}
                        onChange={(e) =>
                          setEditCapsForm((p) => ({ ...p, creditLimit: e.target.value }))
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        <span className="inline-flex items-center gap-1">
                          <Gauge className="w-3 h-3" /> BW Pool Cap (Mbps)
                        </span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        disabled={!canEditDrawerReseller}
                        value={editCapsForm.bandwidthPoolCapMbps}
                        onChange={(e) =>
                          setEditCapsForm((p) => ({ ...p, bandwidthPoolCapMbps: e.target.value }))
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Max Active Users
                      </label>
                      <input
                        type="number"
                        min="0"
                        disabled={!canEditDrawerReseller}
                        value={editCapsForm.maxActiveUsers}
                        onChange={(e) =>
                          setEditCapsForm((p) => ({ ...p, maxActiveUsers: e.target.value }))
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {getResellerTier(drawerReseller) === 'DEALER' && (
                    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 px-3.5 py-2.5 cursor-pointer">
                      <div>
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          Allow Creating Sub-Dealers
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Controls whether this Dealer can onboard nested Sub-Dealers
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={!canEditDrawerReseller}
                        checked={editCapsForm.canCreateSubdealers}
                        onChange={(e) =>
                          setEditCapsForm((p) => ({ ...p, canCreateSubdealers: e.target.checked }))
                        }
                        className="w-4 h-4 accent-cyan-500"
                      />
                    </label>
                  )}

                  {canEditDrawerReseller && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Reset Login Password (Optional)
                      </label>
                      <input
                        type="text"
                        value={editCapsForm.newPassword}
                        onChange={(e) =>
                          setEditCapsForm((p) => ({ ...p, newPassword: e.target.value }))
                        }
                        placeholder="Leave blank to keep existing password"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  )}

                  {canEditDrawerReseller && (
                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={isSavingCaps}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-semibold cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{isSavingCaps ? 'Saving...' : 'Save Reseller Profile'}</span>
                      </button>
                    </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
