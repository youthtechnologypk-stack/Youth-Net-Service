import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import {
  ArrowLeft,
  User,
  Wifi,
  WifiOff,
  Activity,
  Zap,
  RefreshCw,
  Key,
  Edit,
  Plus,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldCheck,
  DollarSign,
  FileText,
  Check,
  Copy,
  Send,
  HardDrive,
  Cpu,
  Radio,
  Layers,
  Server,
  X,
  Eye,
  EyeOff,
  Wrench,
  Receipt,
  History,
  MessageSquareWarning,
  Smartphone,
  MapPin,
  Calendar,
  CreditCard,
  Printer,
  ChevronRight,
  Info,
  Trash2,
} from 'lucide-react';
import {
  supabase,
  SupabasePortalUser,
  SupabaseInvoice,
  SupabasePaymentTransaction,
  SupabaseTicket,
  SupabaseSubscriberInventoryLog,
  SupabaseSubscriberSessionLog,
} from '../services/supabaseClient';
import { safeMikrotikFetch } from '../services/mikrotikRestClient';
import {
  sessionSyncEngine,
  formatBytesTransfer,
  formatDurationHms,
  formatRadiusDateTime,
  formatDisconnectReasonBadge,
  computeExactSessionUptimeSeconds,
  parseRouterOsUptimeSeconds,
} from '../services/sessionSyncEngine';
import { useCurrency } from '../context/CurrencyContext';
import { useISP } from '../context/ISPContext';
import { CreateInvoiceModal, resolvePackageRate } from './CreateInvoiceModal';
import { AreaNodeSelector } from './AreaNodeSelector';
import {
  fetchMikrotikInterfaceTrafficOnce,
  restoreSubscriberOnInvoicePaid,
  addCalendarMonthDateString,
  fetchNetworkAreas,
  resolveAreaFromUsername,
  NetworkAreaNode,
  PARENT_FLEET_ROUTER,
  safeInsertInvoiceInSupabase,
  syncMikrotikSecretProfile,
  kickMikrotikActiveSessionForUser,
} from '../lib/billingAndNetwork';
import { isExpiryOrBlockedProfile } from '../lib/mikrotikProfileSync';
import { buildWhatsAppUrl } from '../lib/whatsappBilling';
import {
  computeBillingAnchorDay,
  computeNextBillingDateFromInstall,
  extractYmdString,
  insertTicketSafe,
  normalizeTicketPriority,
} from '../lib/anniversaryBilling';
import { isMissingTableOrColumnError } from '../lib/expiryUtils';
import { getStoredUser } from '../lib/auth';
import {
  StaffPermissions,
  maskSensitiveCnic,
  resolveStaffPermissions,
} from '../lib/staffPermissions';
import {
  buildOwnershipStamp,
  checkAndDeductResellerWallet,
  doesSubscriberMatchScope,
  filterFieldAgentsForUser,
  getResellerTier,
  isResellerUser,
  refundResellerWallet,
  resolveActiveResellerIdForSubscriber,
  resolveResellerScope,
  stampOwnershipOnPortalUserAndInvoices,
  WalletGatePreviewResult,
} from '../lib/resellerEngine';
import { ResellerWalletGatePreview } from './ResellerWalletGatePreview';
import {
  deleteInventoryLogApi,
  deleteInvoiceApi,
  updateInventoryLogApi,
  updateInvoiceApi,
} from '../lib/inventoryInvoiceSync';

export interface SubscriberProfileViewProps {
  username: string;
  onBack: () => void;
  onOpenReceiptModal?: (invoice: any) => void;
  staffPermissions?: StaffPermissions;
}

export const SubscriberProfileView: React.FC<SubscriberProfileViewProps> = ({
  username,
  onBack,
  onOpenReceiptModal,
  staffPermissions,
}) => {
  const perms = useMemo(
    () => staffPermissions || resolveStaffPermissions(getStoredUser()),
    [staffPermissions]
  );
  const { formatCurrency, currencySymbol } = useCurrency();
  const { routers, selectedRouterId, kickSession, resolveTicket } = useISP();

  const cleanUsername = useMemo(() => (username || '').replace(/^@+/, '').trim(), [username]);
  const activeRouter = useMemo(
    () => routers.find((r) => r.id === selectedRouterId) || routers[0],
    [routers, selectedRouterId]
  );

  // Primary Data States
  const [user, setUser] = useState<SupabasePortalUser | null>(null);
  const [invoices, setInvoices] = useState<SupabaseInvoice[]>([]);
  const [transactions, setTransactions] = useState<SupabasePaymentTransaction[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<SupabaseSubscriberInventoryLog[]>([]);
  const [sessionLogs, setSessionLogs] = useState<SupabaseSubscriberSessionLog[]>([]);
  const [tickets, setTickets] = useState<SupabaseTicket[]>([]);
  const [portalAgents, setPortalAgents] = useState<SupabasePortalUser[]>([]);
  const [mikrotikSecret, setMikrotikSecret] = useState<Record<string, any> | null>(null);
  const [gisFdbLocation, setGisFdbLocation] = useState<string>('');

  // Active MikroTik session state with live RouterOS v7 transferred bytes
  const [activeSession, setActiveSession] = useState<{
    id?: string;
    name?: string;
    address?: string;
    callerId?: string;
    uptime?: string;
    service?: string;
    rawBytesIn?: number;
    rawBytesOut?: number;
    gbIn?: string;
    gbOut?: string;
  } | null>(null);
  const [liveSecretProfile, setLiveSecretProfile] = useState<string>('');
  const [networkAreas, setNetworkAreas] = useState<NetworkAreaNode[]>([]);

  const [isGenerateInvoiceModalOpen, setIsGenerateInvoiceModalOpen] = useState<boolean>(false);

  // Live Speed Gauge Polling State
  const [liveSpeed, setLiveSpeed] = useState<{
    rxMbps: number;
    txMbps: number;
    isPolling: boolean;
    lastUpdated: Date;
  }>({
    rxMbps: 0,
    txMbps: 0,
    isPolling: false,
    lastUpdated: new Date(),
  });

  // UI state
  const [activeTab, setActiveTab] = useState<'inventory' | 'ledger' | 'connection' | 'tickets'>('inventory');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modal States
  const [isKickModalOpen, setIsKickModalOpen] = useState<boolean>(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState<boolean>(false);
  const [isEditUserModalOpen, setIsEditUserModalOpen] = useState<boolean>(false);
  const [isAddMaterialModalOpen, setIsAddMaterialModalOpen] = useState<boolean>(false);
  const [isNewTicketModalOpen, setIsNewTicketModalOpen] = useState<boolean>(false);
  const [isRecordPaymentModalOpen, setIsRecordPaymentModalOpen] = useState<boolean>(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<SupabaseInvoice | null>(null);
  const [paymentAmountInput, setPaymentAmountInput] = useState<number | string>('');
  const [paymentModeInput, setPaymentModeInput] = useState<string>('Cash Handover');
  const [collectingAgentInput, setCollectingAgentInput] = useState<string>('');

  // Password Modal form
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState<boolean>(false);

  // Edit Customer Modal form
  const [editForm, setEditForm] = useState({
    fullName: '',
    phone: '',
    cnic: '',
    address: '',
    area: '',
    installationDate: new Date().toISOString().slice(0, 10),
    accountStatus: 'ACTIVE' as 'ACTIVE' | 'EXPIRED' | 'SUSPENDED',
    packageSpeed: '30 Mbps',
    packageVolumeGb: 1500,
    monthlyFee: 2500,
    onuDeviceModel: '',
    onuMac: '',
    onuPonSerial: '',
    dropWireMeters: 0,
    fiberBoxLocation: '',
    patchCordQty: 1,
    assignedOwnerId: '',
  });
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [editWalletStatus, setEditWalletStatus] = useState<WalletGatePreviewResult | null>(null);
  const [editWalletError, setEditWalletError] = useState<string | null>(null);
  const [paymentWalletStatus, setPaymentWalletStatus] = useState<WalletGatePreviewResult | null>(null);
  const [paymentWalletError, setPaymentWalletError] = useState<string | null>(null);
  const [allResellers, setAllResellers] = useState<SupabasePortalUser[]>([]);
  const isAdminSession = useMemo(() => {
    const u = getStoredUser();
    return String(u?.role || '').toUpperCase() === 'ADMIN' && !isResellerUser(u);
  }, []);
  const activeOwnerResellerId = useMemo(
    () => resolveActiveResellerIdForSubscriber(user, getStoredUser()),
    [user]
  );
  const editRequiresWalletGate = useMemo(() => {
    if (!activeOwnerResellerId) return false;
    const targetPkg = String(editForm.packageSpeed || '').trim();
    const currentPkg = String(
      liveSecretProfile || mikrotikSecret?.profile || user?.original_package_profile || user?.package_speed || ''
    ).trim();
    const isTargetExpiry = !targetPkg || isExpiryOrBlockedProfile(targetPkg);
    const packageChangedToActivePlan =
      Boolean(targetPkg) &&
      !isTargetExpiry &&
      targetPkg.toLowerCase() !== currentPkg.toLowerCase();
    const prevStatus = String(user?.account_status || '').toUpperCase();
    const wasSuspendedOrExpired =
      prevStatus === 'EXPIRED' ||
      prevStatus === 'SUSPENDED' ||
      mikrotikSecret?.disabled === 'true' ||
      mikrotikSecret?.disabled === true ||
      isExpiryOrBlockedProfile(currentPkg);
    const restoringToActive =
      editForm.accountStatus === 'ACTIVE' && wasSuspendedOrExpired && !isTargetExpiry;
    return packageChangedToActivePlan || restoringToActive;
  }, [activeOwnerResellerId, editForm.packageSpeed, editForm.accountStatus, liveSecretProfile, mikrotikSecret, user]);

  const editAnchorDay = useMemo(
    () =>
      computeBillingAnchorDay({
        installation_date: editForm.installationDate || new Date().toISOString().slice(0, 10),
      }),
    [editForm.installationDate]
  );

  const editNextBillingPreview = useMemo(
    () =>
      computeNextBillingDateFromInstall(
        editForm.installationDate || new Date().toISOString().slice(0, 10),
        editAnchorDay
      ),
    [editForm.installationDate, editAnchorDay]
  );

  // Add Material Modal form
  const [materialForm, setMaterialForm] = useState({
    itemName: '2-Core FTTH Drop Wire Cable',
    customItemName: '',
    quantity: 1,
    unitCost: 35,
    installedByAgent: '',
    appendToInvoice: true,
  });
  const [isSavingMaterial, setIsSavingMaterial] = useState<boolean>(false);

  // New Ticket Modal form
  const [ticketForm, setTicketForm] = useState({
    issue: '',
    priority: 'MEDIUM' as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    assignedAgentName: '',
  });
  const [isSavingTicket, setIsSavingTicket] = useState<boolean>(false);
  const [isAccessDenied, setIsAccessDenied] = useState<boolean>(false);
  const [owningDealerLabel, setOwningDealerLabel] = useState<string | null>(null);

  // RBAC: Edit / Delete Inventory Logs & Invoices
  const canEditDeleteLedger = Boolean(perms.edit_delete_invoice || isAdminSession);

  // Edit / Delete Material Log Modal State (Tab 1)
  const [materialToEdit, setMaterialToEdit] = useState<SupabaseSubscriberInventoryLog | null>(null);
  const [editMaterialForm, setEditMaterialForm] = useState({
    itemName: '',
    quantity: 1,
    unitCost: 0,
    installedByAgent: '',
    date: new Date().toISOString().slice(0, 10),
  });
  const [isUpdatingMaterial, setIsUpdatingMaterial] = useState<boolean>(false);
  const [editMaterialError, setEditMaterialError] = useState<string | null>(null);
  const [materialToDelete, setMaterialToDelete] = useState<SupabaseSubscriberInventoryLog | null>(null);
  const [isDeletingMaterial, setIsDeletingMaterial] = useState<boolean>(false);
  const [deleteMaterialError, setDeleteMaterialError] = useState<string | null>(null);

  // Edit / Delete Invoice Modal State (Tab 2)
  const [invoiceToEdit, setInvoiceToEdit] = useState<SupabaseInvoice | null>(null);
  const [editInvoiceForm, setEditInvoiceForm] = useState({
    amount: 0,
    dueDate: new Date().toISOString().slice(0, 10),
    status: 'DUE' as 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE',
    assignedAgentId: '',
    notes: '',
  });
  const [isUpdatingInvoice, setIsUpdatingInvoice] = useState<boolean>(false);
  const [editInvoiceWalletStatus, setEditInvoiceWalletStatus] = useState<WalletGatePreviewResult | null>(null);
  const [editInvoiceError, setEditInvoiceError] = useState<string | null>(null);
  const [invoiceToDelete, setInvoiceToDelete] = useState<SupabaseInvoice | null>(null);
  const [deleteLinkedPayments, setDeleteLinkedPayments] = useState<boolean>(true);
  const [isDeletingInvoice, setIsDeletingInvoice] = useState<boolean>(false);
  const [deleteInvoiceError, setDeleteInvoiceError] = useState<string | null>(null);

  const speedPollingTimerRef = useRef<any>(null);

  const parseUptimeSeconds = (uptimeStr?: string): number => {
    if (!uptimeStr) return 0;
    let total = 0;
    const w = uptimeStr.match(/(\d+)w/);
    const d = uptimeStr.match(/(\d+)d/);
    const h = uptimeStr.match(/(\d+)h/);
    const m = uptimeStr.match(/(\d+)m/);
    const s = uptimeStr.match(/(\d+)s/);
    if (w) total += Number(w[1]) * 604800;
    if (d) total += Number(d[1]) * 86400;
    if (h) total += Number(h[1]) * 3600;
    if (m) total += Number(m[1]) * 60;
    if (s) total += Number(s[1]);
    return total;
  };

  useEffect(() => {
    fetchNetworkAreas().then(setNetworkAreas).catch(() => {});
  }, []);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 4500);
  };

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    showToast(`Copied ${fieldName} to clipboard!`);
    setTimeout(() => setCopiedField(null), 2000);
  };

  // 1. Fetch Complete Profile Data from Supabase & MikroTik
  const fetchAllProfileData = async () => {
    if (!cleanUsername) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // 1.1 Fetch User Record from portal_users (case-insensitive)
      const { data: userData, error: userError } = await supabase
        .from('portal_users')
        .select('*')
        .ilike('username', cleanUsername)
        .limit(1)
        .maybeSingle();

      if (userError) {
        console.warn('Error fetching portal user:', userError);
      }

      // Enforce multi-tier Dealer / Sub-Dealer strict data isolation & resolve ownership hierarchy
      const loggedInUser = getStoredUser();
      const { data: allPortalRowsData } = await supabase
        .from('portal_users')
        .select('*');
      const allPortalRows = (allPortalRowsData || []) as SupabasePortalUser[];
      const resellerRows = allPortalRows.filter((r) => getResellerTier(r) !== null);
      setAllResellers(resellerRows);

      if (isResellerUser(loggedInUser)) {
        const scope = resolveResellerScope(loggedInUser, allPortalRows);
        if (!userData || !doesSubscriberMatchScope(userData as SupabasePortalUser, scope)) {
          setIsAccessDenied(true);
          setUser(null);
          setIsLoading(false);
          return;
        }
        setIsAccessDenied(false);
      } else {
        setIsAccessDenied(false);
      }

      const subDealerRow = userData?.sub_dealer_id
        ? resellerRows.find((r) => r.id === userData.sub_dealer_id) || null
        : null;
      const dealerRow = userData?.dealer_id
        ? resellerRows.find((r) => r.id === userData.dealer_id) || null
        : null;

      if (subDealerRow) {
        const parentSuffix = dealerRow
          ? ` • Dealer: ${dealerRow.full_name || dealerRow.username}`
          : '';
        setOwningDealerLabel(
          `${subDealerRow.full_name || subDealerRow.username} (Sub-Dealer)${parentSuffix}`
        );
      } else if (dealerRow) {
        const tierTag = getResellerTier(dealerRow) === 'SUB_DEALER' ? 'Sub-Dealer' : 'Dealer';
        setOwningDealerLabel(`${dealerRow.full_name || dealerRow.username} (${tierTag})`);
      } else {
        setOwningDealerLabel(null);
      }

      if (userData) {
        setUser(userData as SupabasePortalUser);
        const resolvedInstallDate =
          extractYmdString(userData.installation_date || userData.created_at) ||
          new Date().toISOString().slice(0, 10);
        setEditForm({
          fullName: userData.full_name || '',
          phone: userData.phone || '',
          cnic: userData.cnic || '',
          address: userData.address || '',
          area: userData.area || '',
          installationDate: resolvedInstallDate,
          accountStatus: (userData.account_status as any) || 'ACTIVE',
          packageSpeed: userData.package_speed || '30 Mbps',
          packageVolumeGb: userData.package_volume_gb || 1500,
          monthlyFee: userData.monthly_fee || 2500,
          onuDeviceModel: userData.onu_device_model || '',
          onuMac: userData.onu_mac || '',
          onuPonSerial: userData.onu_pon_serial || '',
          dropWireMeters: userData.drop_wire_meters || 0,
          fiberBoxLocation: userData.fiber_box_location || '',
          patchCordQty: userData.patch_cord_qty || 1,
          assignedOwnerId: userData.sub_dealer_id || userData.dealer_id || '',
        });
      } else {
        setUser(null);
      }

      // 1.2 Fetch Invoices
      const { data: invData } = await supabase
        .from('invoices')
        .select('*')
        .ilike('subscriber_username', cleanUsername)
        .order('created_at', { ascending: false });

      if (invData) {
        setInvoices(invData as SupabaseInvoice[]);
      }

      // 1.3 Fetch Payment Transactions
      const { data: txData } = await supabase
        .from('payment_transactions')
        .select('*')
        .ilike('subscriber_username', cleanUsername)
        .order('payment_date', { ascending: false });

      if (txData) {
        setTransactions(txData as SupabasePaymentTransaction[]);
      }

      // 1.4 Fetch Inventory Logs
      const { data: invLogData } = await supabase
        .from('subscriber_inventory_logs')
        .select('*')
        .ilike('subscriber_username', cleanUsername)
        .order('created_at', { ascending: false });

      if (invLogData) {
        setInventoryLogs(invLogData as SupabaseSubscriberInventoryLog[]);
      }

      // 1.5 Fetch Session Logs (last 50 records ordered by recorded_at DESC)
      const { data: sessLogData } = await supabase
        .from('subscriber_session_logs')
        .select('*')
        .ilike('subscriber_username', cleanUsername)
        .order('recorded_at', { ascending: false })
        .limit(50);

      if (sessLogData) {
        setSessionLogs(sessLogData as SupabaseSubscriberSessionLog[]);
      }

      // 1.6 Fetch Complaints / Tickets
      const { data: tktData } = await supabase
        .from('tickets')
        .select('*')
        .ilike('subscriber_username', cleanUsername)
        .order('created_at', { ascending: false });

      if (tktData) {
        const seenTicketIds = new Set<string>();
        const uniqueTickets = (tktData as SupabaseTicket[]).filter((t) => {
          if (!t?.id || seenTicketIds.has(t.id)) return false;
          seenTicketIds.add(t.id);
          return true;
        });
        setTickets(uniqueTickets);
      }

      // 1.7 Fetch Portal Agents strictly scoped to the logged-in Master ISP / Dealer / Sub-Dealer
      const { data: allAgentsScan } = await supabase
        .from('portal_users')
        .select('*')
        .order('full_name', { ascending: true });

      if (Array.isArray(allAgentsScan)) {
        const allRows = allAgentsScan as SupabasePortalUser[];
        const scopedAgents = filterFieldAgentsForUser(allRows, getStoredUser(), {
          allPortalUsers: allRows,
        });
        setPortalAgents(scopedAgents);
      }

      // 1.7a Lookup GIS FDB Port & Node assignment for real FAT / DP location
      try {
        let resolvedFdb = '';
        const { data: portData } = await supabase
          .from('gis_fdb_ports')
          .select('fdb_id')
          .ilike('pppoe_username', cleanUsername)
          .limit(1)
          .maybeSingle();

        if (portData?.fdb_id) {
          const { data: nodeData } = await supabase
            .from('gis_nodes')
            .select('name, label')
            .eq('id', portData.fdb_id)
            .maybeSingle();
          if (nodeData) {
            resolvedFdb = String(nodeData.label || nodeData.name || '');
          }
        }
        setGisFdbLocation(resolvedFdb);
      } catch {
        setGisFdbLocation('');
      }

      // 1.7b Query MikroTik /ppp/secret strictly for this subscriber's actual PPPoE profile
      try {
        let secRes = await safeMikrotikFetch(
          `/api/mikrotik/ppp/secret?name=${encodeURIComponent(cleanUsername)}`,
          {},
          activeRouter
        );
        let secrets = secRes.ok ? await secRes.json() : [];
        if (!Array.isArray(secrets) || secrets.length === 0) {
          secRes = await safeMikrotikFetch('/api/mikrotik/ppp/secret', {}, activeRouter);
          secrets = secRes.ok ? await secRes.json() : [];
        }
        if (Array.isArray(secrets)) {
          const secMatch = secrets.find(
            (s: any) => String(s?.name || '').toLowerCase() === cleanUsername.toLowerCase()
          );
          setMikrotikSecret(secMatch || null);
          setLiveSecretProfile(secMatch?.profile ? String(secMatch.profile) : '');
        } else {
          setMikrotikSecret(null);
          setLiveSecretProfile('');
        }
      } catch {
        setMikrotikSecret(null);
        setLiveSecretProfile('');
      }

      // 1.8 Query MikroTik for live active session strictly for this username (read-only)
      try {
        const queryUrl = `/api/mikrotik/ppp/active?name=${encodeURIComponent(cleanUsername)}`;
        let res = await safeMikrotikFetch(queryUrl, {}, activeRouter);
        if (!res.ok) {
          res = await safeMikrotikFetch('/api/mikrotik/ppp/active', {}, activeRouter);
        }

        if (res.ok) {
          const sessions = await res.json();
          if (Array.isArray(sessions)) {
            const match = sessions.find(
              (s: any) => String(s?.name || '').toLowerCase() === cleanUsername.toLowerCase()
            );

            if (match) {
              let rawBytesIn = 0;
              let rawBytesOut = 0;
              if (match.bytes && typeof match.bytes === 'string' && match.bytes.includes('/')) {
                const parts = match.bytes.split('/');
                rawBytesIn = Number(parts[0]) || 0;
                rawBytesOut = Number(parts[1]) || 0;
              } else {
                rawBytesIn = Number(match['rx-byte'] || match['bytes-in'] || match['rx-bytes'] || 0);
                rawBytesOut = Number(match['tx-byte'] || match['bytes-out'] || match['tx-bytes'] || 0);
              }

              // Check <pppoe-username> interface counters for exact TX/RX byte totals
              try {
                const ifaceRes = await safeMikrotikFetch(
                  `/api/mikrotik/interface?name=${encodeURIComponent(`<pppoe-${cleanUsername}>`)}`,
                  {},
                  activeRouter
                );
                if (ifaceRes.ok) {
                  const ifaces = await ifaceRes.json();
                  const ifaceMatch = Array.isArray(ifaces)
                    ? ifaces.find((i: any) => {
                        const n = (i?.name || '').toLowerCase();
                        return n === `<pppoe-${cleanUsername.toLowerCase()}>` || n === `pppoe-${cleanUsername.toLowerCase()}`;
                      }) || ifaces[0]
                    : ifaces;
                  if (ifaceMatch) {
                    rawBytesIn = Math.max(rawBytesIn, Number(ifaceMatch['rx-byte'] || 0));
                    rawBytesOut = Math.max(rawBytesOut, Number(ifaceMatch['tx-byte'] || 0));
                  }
                }
              } catch {}

              const gbIn = (Number(rawBytesIn) / (1024 * 1024 * 1024)).toFixed(2);
              const gbOut = (Number(rawBytesOut) / (1024 * 1024 * 1024)).toFixed(2);

              setActiveSession({
                id: match['.id'],
                name: match.name,
                address: match.address || '',
                callerId: match['caller-id'] || '',
                uptime: match.uptime,
                service: match.service,
                rawBytesIn,
                rawBytesOut,
                gbIn,
                gbOut,
              });
            } else {
              setActiveSession(null);
              const healedLogs = await sessionSyncEngine.reconcileOfflineSubscriberActiveRows(
                cleanUsername,
                false
              );
              if (healedLogs) {
                setSessionLogs(healedLogs);
              }
            }
          }
        }
      } catch (err) {
        // Router proxy offline or unreachable, handle gracefully
      }
    } catch (err: any) {
      console.error('Error fetching subscriber profile:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllProfileData();
  }, [cleanUsername, activeRouter?.id]);

  // Real-time Supabase subscription for subscriber_session_logs
  useEffect(() => {
    if (!cleanUsername) return;
    const refreshSessionLogsOnly = async () => {
      const { data } = await supabase
        .from('subscriber_session_logs')
        .select('*')
        .ilike('subscriber_username', cleanUsername)
        .order('recorded_at', { ascending: false })
        .limit(50);
      if (Array.isArray(data)) {
        setSessionLogs(data as SupabaseSubscriberSessionLog[]);
      }
    };

    const channel = supabase
      .channel(`profile-session-logs-${cleanUsername.toLowerCase()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'subscriber_session_logs' },
        (payload: any) => {
          const changedUser = (
            payload?.new?.subscriber_username ||
            payload?.old?.subscriber_username ||
            ''
          ).toLowerCase();
          if (changedUser === cleanUsername.toLowerCase()) {
            void refreshSessionLogsOnly();
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [cleanUsername]);

  // 2. Real-time Live Speed Gauge Poller (Runs every 15s with single in-flight lock, read-only ?once)
  useEffect(() => {
    let isMounted = true;
    let inFlight = false;

    const pollSpeed = async () => {
      if (!activeSession || !cleanUsername) {
        if (isMounted) {
          setLiveSpeed({
            rxMbps: 0,
            txMbps: 0,
            isPolling: false,
            lastUpdated: new Date(),
          });
        }
        return;
      }
      if (inFlight || (typeof document !== 'undefined' && document.hidden)) return;
      inFlight = true;

      try {
        setLiveSpeed((prev) => ({ ...prev, isPolling: true }));
        let result = await fetchMikrotikInterfaceTrafficOnce(`<pppoe-${cleanUsername}>`, activeRouter);
        if (!result.ok) {
          result = await fetchMikrotikInterfaceTrafficOnce(`pppoe-${cleanUsername}`, activeRouter);
        }

        let rxMbps = result.ok ? result.rxMbps : 0;
        let txMbps = result.ok ? result.txMbps : 0;
        let pollingOk = result.ok;

        if (!result.ok || (rxMbps === 0 && txMbps === 0)) {
          try {
            const qRes = await safeMikrotikFetch('/api/mikrotik/queue/simple', {}, activeRouter);
            if (qRes.ok) {
              const queues = await qRes.json();
              if (Array.isArray(queues)) {
                const targetIp = String(activeSession.address || '').trim();
                const lowerUser = cleanUsername.toLowerCase();
                const qMatch = queues.find((q: any) => {
                  const qTarget = String(q?.target || '');
                  const qName = String(q?.name || '').toLowerCase();
                  return (
                    (targetIp && qTarget.includes(targetIp)) ||
                    qName.includes(lowerUser)
                  );
                });
                if (qMatch && typeof qMatch.rate === 'string' && qMatch.rate.includes('/')) {
                  const [rawTxBps, rawRxBps] = qMatch.rate.split('/');
                  const parsedTx = Number(((Number(rawTxBps) || 0) / 1_000_000).toFixed(2));
                  const parsedRx = Number(((Number(rawRxBps) || 0) / 1_000_000).toFixed(2));
                  txMbps = Math.max(txMbps, parsedTx);
                  rxMbps = Math.max(rxMbps, parsedRx);
                  pollingOk = true;
                }
              }
            }
          } catch {}
        }

        if (isMounted) {
          setLiveSpeed({
            rxMbps,
            txMbps,
            isPolling: pollingOk,
            lastUpdated: new Date(),
          });
        }
      } catch {
        if (isMounted) {
          setLiveSpeed((prev) => ({ ...prev, rxMbps: 0, txMbps: 0, isPolling: false }));
        }
      } finally {
        inFlight = false;
      }
    };

    pollSpeed();
    speedPollingTimerRef.current = setInterval(pollSpeed, 15000);

    return () => {
      isMounted = false;
      if (speedPollingTimerRef.current) {
        clearInterval(speedPollingTimerRef.current);
      }
    };
  }, [cleanUsername, Boolean(activeSession), activeSession?.address, activeRouter?.id]);

  // Financial Balances Calculation
  const totalInvoiced = useMemo(() => {
    return (invoices || []).reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
  }, [invoices]);

  const totalPaid = useMemo(() => {
    return (invoices || []).reduce((acc, i) => {
      return acc + (Number(i.paid_amount) || (i.status === 'PAID' ? Number(i.amount) : 0));
    }, 0);
  }, [invoices]);

  const netBalance = Math.max(0, totalInvoiced - totalPaid);

  // Data Usage Calculations for Donut Chart (Current Billing Cycle from subscriber_session_logs)
  const packageTotalGb = user?.package_volume_gb || 1500;
  const consumedGb = useMemo(() => {
    const now = new Date();
    const paidInvoices = (invoices || []).filter((i) => i.status === 'PAID' && (i.paid_at || i.created_at));
    const cycleStartMs =
      paidInvoices.length > 0
        ? Math.max(
            new Date(paidInvoices[0].paid_at || paidInvoices[0].created_at || 0).getTime(),
            now.getTime() - 31 * 86400 * 1000
          )
        : new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    const seenIds = new Set<string>();
    const cycleLogs = (sessionLogs || []).filter((s) => {
      const rowKey = s.id || `${s.connected_at}-${s.session_id || ''}`;
      if (seenIds.has(rowKey)) return false;
      seenIds.add(rowKey);
      const ts = new Date(s.connected_at || s.recorded_at || 0).getTime();
      return !Number.isNaN(ts) && ts >= cycleStartMs;
    });

    const liveSessionBytes = (activeSession?.rawBytesIn || 0) + (activeSession?.rawBytesOut || 0);
    let hasActiveLogRow = false;

    const fromLogsBytes = cycleLogs.reduce((acc, s) => {
      const rowBytes = Number(s.bytes_in || 0) + Number(s.bytes_out || 0);
      const isRowActive = (s.session_status || '').toUpperCase() === 'ACTIVE' && !s.disconnected_at;
      if (isRowActive && !hasActiveLogRow) {
        hasActiveLogRow = true;
        return acc + Math.max(rowBytes, liveSessionBytes);
      }
      return acc + rowBytes;
    }, 0);

    const totalBytes = hasActiveLogRow ? fromLogsBytes : fromLogsBytes + liveSessionBytes;
    const fromTotalGb = Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
    return Math.min(fromTotalGb, packageTotalGb);
  }, [sessionLogs, activeSession, invoices, packageTotalGb]);

  const remainingGb = Number(Math.max(0, packageTotalGb - consumedGb).toFixed(2));
  const usagePercentage = Math.min(100, Math.round((consumedGb / packageTotalGb) * 100));

  // Action 1: Disconnect / Kick Session
  const handleKickSession = async () => {
    try {
      let sessionId = activeSession?.id;
      if (!sessionId) {
        try {
          const actRes = await safeMikrotikFetch(
            `/api/mikrotik/ppp/active?name=${encodeURIComponent(cleanUsername)}`,
            {},
            activeRouter
          );
          if (actRes.ok) {
            const actData = await actRes.json();
            if (Array.isArray(actData)) {
              const match = actData.find(
                (s: any) => String(s?.name || '').toLowerCase() === cleanUsername.toLowerCase()
              );
              if (match) sessionId = match['.id'];
            }
          }
        } catch {}
      }

      // Finalize active session log in Supabase as KICKED before disconnecting on RouterOS
      await sessionSyncEngine.finalizeSessionKick(
        cleanUsername,
        {
          id: sessionId,
          username: cleanUsername,
          address: activeSession?.address,
          callerId: activeSession?.callerId,
          uptime: activeSession?.uptime,
          rawBytesIn: activeSession?.rawBytesIn,
          rawBytesOut: activeSession?.rawBytesOut,
        }
      );

      if (sessionId) {
        // Call router kick endpoint
        await safeMikrotikFetch(
          '/api/mikrotik/ppp/active/remove',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ '.id': sessionId }),
          },
          activeRouter
        ).catch(() => {});
      }

      // Also call server kick helper if configured
      try {
        await safeMikrotikFetch(
          '/api/mikrotik/kick',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: cleanUsername, sessionId: sessionId || '*1' }),
          },
          activeRouter
        );
      } catch {}

      setActiveSession(null);
      setIsKickModalOpen(false);
      showToast(`Subscriber @${cleanUsername} disconnected from MikroTik router.`);
      await fetchAllProfileData();
    } catch (err: any) {
      showToast(`Failed to disconnect: ${err.message}`, 'error');
    }
  };

  // Action 2: Change Password
  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!perms.view_passwords) {
      showToast('Permission required: Reveal & manage subscriber PPPoE passwords is disabled for your account.', 'error');
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      showToast('Password must be at least 4 characters long', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      // 1. Update in Supabase portal_users
      const updateQuery = user?.id
        ? supabase.from('portal_users').update({ password: newPassword }).eq('id', user.id)
        : supabase.from('portal_users').update({ password: newPassword }).ilike('username', cleanUsername);
      const { error: sbError } = await updateQuery;

      if (sbError) throw new Error(sbError.message);

      // 2. Dispatch update to MikroTik /ppp/secret/set
      try {
        await safeMikrotikFetch(
          '/api/mikrotik/ppp/secret/set',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: cleanUsername,
              password: newPassword,
            }),
          },
          activeRouter
        );
      } catch {}

      showToast(`Password successfully updated & synchronized to MikroTik!`);
      setIsPasswordModalOpen(false);
      setNewPassword('');
      setConfirmPassword('');
      await fetchAllProfileData();
    } catch (err: any) {
      showToast(`Error updating password: ${err.message}`, 'error');
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Action 3: Save Edited Customer Details (with Prepaid Reseller Wallet Payment Gate on Package Change / Restore)
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditWalletError(null);

    if (editRequiresWalletGate && editWalletStatus?.blocked) {
      const msg =
        editWalletStatus.error || 'Prepaid reseller wallet gate blocked this package assignment.';
      setEditWalletError(msg);
      showToast(msg, 'error');
      return;
    }

    setIsSavingEdit(true);
    let chargedAmount = 0;
    const actingUser = getStoredUser();

    try {
      const normalizedInstallDate =
        extractYmdString(editForm.installationDate) || new Date().toISOString().slice(0, 10);
      const anchorDay = computeBillingAnchorDay({ installation_date: normalizedInstallDate });
      const nextBillingDate = computeNextBillingDateFromInstall(normalizedInstallDate, anchorDay);
      const targetPackageProfile = String(editForm.packageSpeed || '').trim();

      // STRICT PREPAID WALLET PAYMENT GATE BEFORE CHANGING PACKAGE OR RESTORING ACTIVE STATUS
      if (editRequiresWalletGate && activeOwnerResellerId && targetPackageProfile) {
        const walletCheck = await checkAndDeductResellerWallet({
          resellerId: activeOwnerResellerId,
          profileName: targetPackageProfile,
          subscriberUsername: cleanUsername,
          txType: 'RENEWAL_DEDUCTION',
          performedBy: actingUser?.fullName || actingUser?.username || 'Subscriber Profile Desk',
          notes: `Subscriber 360 package/restore update for @${cleanUsername} -> ${targetPackageProfile}`,
        });

        if (!walletCheck.ok) {
          const msg =
            walletCheck.error || 'Insufficient Dealer Wallet Balance. Package update blocked.';
          setEditWalletError(msg);
          showToast(msg, 'error');
          setIsSavingEdit(false);
          return;
        }
        chargedAmount = Number(walletCheck.chargedAmount || 0);

        const mkRes = await syncMikrotikSecretProfile(
          cleanUsername,
          targetPackageProfile,
          { disabled: 'false' },
          activeRouter
        );
        if (!mkRes.ok) {
          let refundMsg = '';
          if (chargedAmount > 0) {
            const refundRes = await refundResellerWallet({
              resellerId: activeOwnerResellerId,
              amount: chargedAmount,
              profileName: targetPackageProfile,
              subscriberUsername: cleanUsername,
              performedBy: actingUser?.fullName || actingUser?.username || 'System Auto-Refund',
              reason: `Auto-refund: MikroTik profile update failed for @${cleanUsername} (${(mkRes as any).error || 'Router error'})`,
            });
            refundMsg = refundRes.ok
              ? ` Wallet automatically refunded Rs. ${chargedAmount.toLocaleString()}.`
              : ` Refund warning: ${refundRes.error || 'Please reconcile wallet.'}`;
          }
          const failMsg = `${(mkRes as any).error || 'MikroTik profile sync failed.'}${refundMsg}`;
          setEditWalletError(failMsg);
          showToast(failMsg, 'error');
          setIsSavingEdit(false);
          return;
        }
        await kickMikrotikActiveSessionForUser(cleanUsername, activeRouter).catch(() => {});
      }

      const baseUpdatePayload: Partial<SupabasePortalUser> = {
        full_name: editForm.fullName,
        phone: editForm.phone,
        cnic: perms.view_passwords ? editForm.cnic : (user?.cnic || ''),
        address: editForm.address,
        area: editForm.area,
        installation_date: normalizedInstallDate,
        expiry_date: nextBillingDate,
        account_status: editForm.accountStatus,
        package_speed: editForm.packageSpeed,
        package_volume_gb: Number(editForm.packageVolumeGb),
        monthly_fee: Number(editForm.monthlyFee),
        onu_device_model: editForm.onuDeviceModel,
        onu_mac: editForm.onuMac,
        onu_pon_serial: editForm.onuPonSerial,
        drop_wire_meters: Number(editForm.dropWireMeters),
        fiber_box_location: editForm.fiberBoxLocation,
        patch_cord_qty: Number(editForm.patchCordQty),
        ...(editRequiresWalletGate && targetPackageProfile
          ? {
              original_package_profile: targetPackageProfile,
              package_profile_name: targetPackageProfile,
              is_suspended: false,
            }
          : {}),
      };

      const extendedPayload: Partial<SupabasePortalUser> = {
        ...baseUpdatePayload,
        billing_anchor_day: anchorDay,
        next_billing_date: nextBillingDate,
      };

      const runUpdate = (payload: Partial<SupabasePortalUser>) =>
        user?.id
          ? supabase.from('portal_users').update(payload as any).eq('id', user.id)
          : supabase.from('portal_users').update(payload as any).ilike('username', cleanUsername);

      let { error } = await runUpdate(extendedPayload);
      if (error && isMissingTableOrColumnError(error)) {
        const retry = await runUpdate(baseUpdatePayload);
        error = retry.error;
      }

      if (error) throw new Error(error.message);

      // Admin-only owner reassignment: move subscriber + their invoices to Master Direct / Dealer / Sub-Dealer
      if (isAdminSession) {
        const currentOwnerId = user?.sub_dealer_id || user?.dealer_id || '';
        if (editForm.assignedOwnerId !== currentOwnerId) {
          const selectedOwner = editForm.assignedOwnerId
            ? allResellers.find((r) => r.id === editForm.assignedOwnerId) || null
            : null;
          const loggedInUser = getStoredUser();
          const newStamp = buildOwnershipStamp(loggedInUser, selectedOwner);
          await stampOwnershipOnPortalUserAndInvoices(cleanUsername, newStamp, {
            userId: user?.id,
            updateInvoices: true,
          });
        }
      }

      showToast(
        `Subscriber @${cleanUsername} updated! Billing Day: ${anchorDay} of every month • Next Due: ${nextBillingDate}.`
      );
      setIsEditUserModalOpen(false);
      await fetchAllProfileData();
    } catch (err: any) {
      setEditWalletError(err?.message || 'Update failed.');
      showToast(`Update error: ${err.message}`, 'error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Action 4: Add Maintenance Material / Wire Charge (Tab 1)
  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingMaterial(true);
    try {
      const targetItem = materialForm.itemName === 'Custom'
        ? materialForm.customItemName || 'Custom Material'
        : materialForm.itemName;

      const qty = Number(materialForm.quantity) || 1;
      const cost = Number(materialForm.unitCost) || 0;
      const totalCharge = qty * cost;

      // 1. Insert into subscriber_inventory_logs
      const { error: invErr } = await supabase.from('subscriber_inventory_logs').insert([{
        subscriber_username: cleanUsername,
        item_name: targetItem,
        quantity: qty,
        unit_cost: cost,
        added_to_invoice: materialForm.appendToInvoice,
        installed_by_agent_name: materialForm.installedByAgent || portalAgents[0]?.full_name || 'Field Technician',
        created_at: new Date().toISOString(),
      }]);

      if (invErr) throw new Error(invErr.message);

      // 2. If append to invoice is checked, prefer existing unpaid INV-MAT-* invoice, otherwise append to latest unpaid invoice or create INV-MAT-*
      if (materialForm.appendToInvoice && totalCharge > 0) {
        const unpaidMatInv = invoices.find(
          (i) =>
            String(i.invoice_no || '').toUpperCase().startsWith('INV-MAT-') &&
            (i.status || '').toUpperCase() !== 'PAID'
        );
        const unpaidInv = unpaidMatInv || invoices.find((i) => (i.status || '').toUpperCase() !== 'PAID');
        if (unpaidInv) {
          const newAmount = Number(unpaidInv.amount) + totalCharge;
          await supabase.from('invoices').update({ amount: newAmount }).eq('id', unpaidInv.id);
        } else {
          const anchorDay = user ? computeBillingAnchorDay(user) : new Date().getDate();
          const nextDue = addCalendarMonthDateString(new Date(), anchorDay);
          const loggedInActor = getStoredUser();
          const matStamp = isResellerUser(loggedInActor)
            ? buildOwnershipStamp(loggedInActor)
            : {
                dealer_id: user?.dealer_id || null,
                sub_dealer_id: user?.sub_dealer_id || null,
                created_by_id: loggedInActor?.id || null,
              };
          await safeInsertInvoiceInSupabase({
            invoice_no: `INV-MAT-${Math.floor(1000 + Math.random() * 9000)}`,
            subscriber_username: cleanUsername,
            amount: totalCharge,
            paid_amount: 0,
            status: 'DUE',
            due_date: nextDue,
            cycle_day: anchorDay,
            assigned_agent_name: materialForm.installedByAgent || 'NOC Billing',
            ...(matStamp.dealer_id ? { dealer_id: matStamp.dealer_id } : {}),
            ...(matStamp.sub_dealer_id ? { sub_dealer_id: matStamp.sub_dealer_id } : {}),
            ...(matStamp.created_by_id ? { created_by_id: matStamp.created_by_id } : {}),
          });
        }
      }

      showToast(`Material ${targetItem} (Rs. ${totalCharge}) logged to subscriber hardware log!`);
      setIsAddMaterialModalOpen(false);
      setMaterialForm({
        itemName: '2-Core FTTH Drop Wire Cable',
        customItemName: '',
        quantity: 1,
        unitCost: 35,
        installedByAgent: '',
        appendToInvoice: true,
      });
      await fetchAllProfileData();
    } catch (err: any) {
      showToast(`Error adding material: ${err.message}`, 'error');
    } finally {
      setIsSavingMaterial(false);
    }
  };

  // Action 5: Log New Complaint / Service Ticket (Tab 4)
  const handleSaveTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingTicket) return;
    if (!ticketForm.issue.trim()) {
      showToast('Please enter complaint details', 'error');
      return;
    }

    setIsSavingTicket(true);
    try {
      const selectedAgent =
        portalAgents.find(
          (ag) =>
            ag.full_name === ticketForm.assignedAgentName ||
            ag.id === ticketForm.assignedAgentName
        ) || (ticketForm.assignedAgentName ? undefined : portalAgents[0]);
      const resolvedAgentId = selectedAgent?.id || null;
      const resolvedAgentName =
        selectedAgent?.full_name || ticketForm.assignedAgentName || 'NOC Support';

      const ticketNo = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;
      const { error } = await insertTicketSafe(supabase, {
        ticket_no: ticketNo,
        subscriber_username: cleanUsername,
        issue: ticketForm.issue.trim(),
        priority: normalizeTicketPriority(ticketForm.priority),
        status: resolvedAgentId ? 'IN_PROGRESS' : 'OPEN',
        assigned_agent_id: resolvedAgentId,
        assigned_agent_name: resolvedAgentName,
        created_at: new Date().toISOString(),
      });

      if (error) throw new Error(error.message);

      showToast(`Ticket #${ticketNo} logged successfully! Assigned to ${resolvedAgentName}.`);
      setIsNewTicketModalOpen(false);
      setTicketForm({
        issue: '',
        priority: 'MEDIUM',
        assignedAgentName: '',
      });
      await fetchAllProfileData();
    } catch (err: any) {
      showToast(`Error logging ticket: ${err.message}`, 'error');
    } finally {
      setIsSavingTicket(false);
    }
  };

  // Action 6: Record Payment on an Invoice
  const handleConfirmPayment = async () => {
    if (!perms.collect_fee) {
      showToast('Permission required: Receive Cash / Mark Invoice Paid is disabled for your account.', 'error');
      return;
    }
    if (!selectedInvoiceForPayment) return;
    const enteredVal = Number(paymentAmountInput);
    if (isNaN(enteredVal) || enteredVal <= 0) {
      showToast('Please enter a valid payment amount', 'error');
      return;
    }

    try {
      const inv = selectedInvoiceForPayment;
      const totalAmount = Number(inv.amount || 0);
      const previousPaid = Number(inv.paid_amount || 0);
      const newPaidTotal = previousPaid + enteredVal;
      const remaining = totalAmount - newPaidTotal;

      // Strictly evaluate PAID vs PARTIAL
      const newStatus = remaining <= 0 ? 'PAID' : 'PARTIAL';
      const finalPaidAmount = remaining <= 0 ? totalAmount : newPaidTotal;
      const nowIso = new Date().toISOString();

      // 1. Update invoice with calendar-month anniversary renewal on PAID
      const anchorDay = user ? computeBillingAnchorDay(user) : (inv.cycle_day || new Date().getDate());
      const invUpdate: Partial<SupabaseInvoice> = {
        status: newStatus,
        paid_amount: finalPaidAmount,
        paid_at: newStatus === 'PAID' ? nowIso : (inv.paid_at || null),
        cycle_day: anchorDay,
      };
      if (newStatus === 'PAID') {
        invUpdate.due_date = addCalendarMonthDateString(
          inv.due_date && inv.due_date >= new Date().toISOString().slice(0, 10)
            ? inv.due_date
            : new Date(),
          anchorDay
        );
      }
      setPaymentWalletError(null);
      if (newStatus === 'PAID') {
        if (paymentWalletStatus?.blocked) {
          const msg =
            paymentWalletStatus.error || 'Insufficient Dealer Wallet Balance. Renewal blocked.';
          setPaymentWalletError(msg);
          showToast(msg, 'error');
          return;
        }
        const restoreRes = await restoreSubscriberOnInvoicePaid(cleanUsername, {
          triggeredBy: 'ADMIN',
          performedBy: getStoredUser()?.fullName || getStoredUser()?.username || 'Subscriber 360 Desk',
          notes: `Payment recorded via 360 Profile on Invoice #${inv.invoice_no}`,
          activeRouter,
        });
        if (restoreRes.insufficientWalletFunds || !restoreRes.success) {
          const msg =
            restoreRes.error || 'Insufficient Dealer Wallet Balance. Renewal blocked.';
          setPaymentWalletError(msg);
          showToast(msg, 'error');
          return;
        }
      }

      await supabase.from('invoices').update(invUpdate).eq('id', inv.id);

      // 2. Increment collecting agent cash
      if (collectingAgentInput) {
        const { data: agentRec } = await supabase.from('portal_users').select('id, cash_in_hand').eq('id', collectingAgentInput).maybeSingle();
        if (agentRec) {
          const cur = Number(agentRec.cash_in_hand) || 0;
          await supabase.from('portal_users').update({ cash_in_hand: cur + enteredVal }).eq('id', agentRec.id);
        }
      }

      // 3. Insert transaction
      const agentObj = portalAgents.find(a => a.id === collectingAgentInput);
      await supabase.from('payment_transactions').insert([{
        invoice_id: inv.id,
        subscriber_username: cleanUsername,
        collected_by_id: collectingAgentInput || null,
        collected_by_name: agentObj?.full_name || 'NOC Billing Desk',
        amount_paid: enteredVal,
        payment_mode: paymentModeInput,
        notes: `Recorded via Subscriber 360 Profile (${newStatus})`,
      }]);

      showToast(`Payment of ${formatCurrency(enteredVal)} recorded! Status: ${newStatus}`);
      setIsRecordPaymentModalOpen(false);
      setSelectedInvoiceForPayment(null);
      await fetchAllProfileData();
    } catch (err: any) {
      showToast(`Payment error: ${err.message}`, 'error');
    }
  };

  // Action 7: Open Edit Material Modal (Tab 1)
  const handleOpenEditMaterial = (log: SupabaseSubscriberInventoryLog) => {
    if (!canEditDeleteLedger) {
      showToast('Permission required: Edit & Delete Invoice / Hardware Log is disabled for your account.', 'error');
      return;
    }
    setEditMaterialError(null);
    setMaterialToEdit(log);
    const dateVal = log.created_at
      ? extractYmdString(log.created_at) || new Date().toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    setEditMaterialForm({
      itemName: log.item_name || '',
      quantity: Number(log.quantity) || 1,
      unitCost: Number(log.unit_cost) || 0,
      installedByAgent: log.installed_by_agent_name || '',
      date: dateVal,
    });
  };

  // Action 8: Save Edited Material Log + Auto-Sync Linked INV-MAT Invoice
  const handleUpdateMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditDeleteLedger || !materialToEdit?.id) return;
    setEditMaterialError(null);
    const trimmedItem = editMaterialForm.itemName.trim();
    const qty = Number(editMaterialForm.quantity);
    const cost = Number(editMaterialForm.unitCost);
    if (!trimmedItem) {
      const msg = 'Please enter an Item Name.';
      setEditMaterialError(msg);
      showToast(msg, 'error');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(cost) || cost < 0) {
      const msg = 'Quantity must be greater than 0 and Unit Cost cannot be negative.';
      setEditMaterialError(msg);
      showToast(msg, 'error');
      return;
    }

    setIsUpdatingMaterial(true);
    try {
      const dateIso = editMaterialForm.date
        ? new Date(`${editMaterialForm.date}T12:00:00.000Z`).toISOString()
        : materialToEdit.created_at || new Date().toISOString();

      const res = await updateInventoryLogApi(materialToEdit.id, {
        item_name: trimmedItem,
        quantity: qty,
        unit_cost: cost,
        installed_by_agent_name: editMaterialForm.installedByAgent || 'Field Technician',
        installed_by: editMaterialForm.installedByAgent || 'Field Technician',
        created_at: dateIso,
      });

      if (res.data) {
        setInventoryLogs((prev) =>
          prev.map((row) => (row.id === materialToEdit.id ? { ...row, ...res.data } : row))
        );
      }

      const syncNote =
        res.invoiceSync && res.invoiceSync.action !== 'NOOP'
          ? ` ${res.invoiceSync.reason}`
          : '';
      showToast(`Material "${trimmedItem}" updated!${syncNote}`);
      setEditMaterialError(null);
      setMaterialToEdit(null);
      await fetchAllProfileData();
    } catch (err: any) {
      const msg = err?.message || 'Failed to update material log.';
      setEditMaterialError(msg);
      showToast(msg, 'error');
    } finally {
      setIsUpdatingMaterial(false);
    }
  };

  // Action 9: Delete Material Log + Auto-Sync / Cleanup Linked INV-MAT Invoice
  const handleDeleteMaterial = async () => {
    if (!canEditDeleteLedger || !materialToDelete?.id) return;
    setDeleteMaterialError(null);
    setIsDeletingMaterial(true);
    try {
      const targetId = materialToDelete.id;
      const itemLabel = materialToDelete.item_name;
      const res = await deleteInventoryLogApi(targetId);
      setInventoryLogs((prev) => prev.filter((row) => row.id !== targetId));
      const syncNote =
        res.invoiceSync && res.invoiceSync.action !== 'NOOP'
          ? ` ${res.invoiceSync.reason}`
          : '';
      showToast(`Material "${itemLabel}" deleted.${syncNote}`);
      setDeleteMaterialError(null);
      setMaterialToDelete(null);
      await fetchAllProfileData();
    } catch (err: any) {
      const msg = err?.message || 'Failed to delete material log.';
      setDeleteMaterialError(msg);
      showToast(msg, 'error');
    } finally {
      setIsDeletingMaterial(false);
    }
  };

  // Action 10: Open Edit Invoice Modal (Tab 2)
  const handleOpenEditInvoice = (inv: SupabaseInvoice) => {
    if (!canEditDeleteLedger) {
      showToast('Permission required: Edit & Delete Invoice is disabled for your account.', 'error');
      return;
    }
    setEditInvoiceError(null);
    setEditInvoiceWalletStatus(null);
    setInvoiceToEdit(inv);
    setEditInvoiceForm({
      amount: Number(inv.amount) || 0,
      dueDate: inv.due_date ? String(inv.due_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
      status: ((inv.status || 'DUE').toUpperCase() as 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE'),
      assignedAgentId: inv.assigned_agent_id || '',
      notes: inv.notes || '',
    });
  };

  // Action 11: Save Edited Invoice + Refresh KPI Cards
  const handleUpdateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditDeleteLedger || !invoiceToEdit) return;
    setEditInvoiceError(null);

    const amountNum = Number(editInvoiceForm.amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setEditInvoiceError('Amount must be 0 or greater.');
      return;
    }

    const wasPaid = String(invoiceToEdit.status || '').toUpperCase() === 'PAID';
    const becomingPaid = editInvoiceForm.status === 'PAID' && !wasPaid;

    if (becomingPaid && editInvoiceWalletStatus?.blocked) {
      const msg =
        editInvoiceWalletStatus.error || 'Insufficient Dealer Wallet Balance. Renewal blocked.';
      setEditInvoiceError(msg);
      showToast(msg, 'error');
      return;
    }

    setIsUpdatingInvoice(true);
    try {
      let restoreNote = '';
      if (becomingPaid) {
        const restoreRes = await restoreSubscriberOnInvoicePaid(cleanUsername, {
          triggeredBy: 'ADMIN',
          performedBy: getStoredUser()?.fullName || getStoredUser()?.username || 'Subscriber 360 Desk',
          notes: `Invoice #${invoiceToEdit.invoice_no} marked PAID via Subscriber 360 Edit`,
          activeRouter,
        });
        if (restoreRes.insufficientWalletFunds || (!restoreRes.success && restoreRes.error)) {
          throw new Error(restoreRes.error || 'Insufficient Dealer Wallet Balance. Renewal blocked.');
        }
        if (restoreRes.restoredProfile) {
          restoreNote = ` Restored MikroTik profile "${restoreRes.restoredProfile}".`;
        }
      }

      const selectedAgent = portalAgents.find((a) => a.id === editInvoiceForm.assignedAgentId);
      const nextPaidAmount =
        editInvoiceForm.status === 'PAID'
          ? amountNum
          : editInvoiceForm.status === 'DUE' || editInvoiceForm.status === 'OVERDUE'
          ? 0
          : Math.min(amountNum, Number(invoiceToEdit.paid_amount) || 0);

      const res = await updateInvoiceApi(invoiceToEdit.id, {
        amount: amountNum,
        due_date: editInvoiceForm.dueDate,
        status: editInvoiceForm.status,
        assigned_agent_id: editInvoiceForm.assignedAgentId || null,
        assigned_agent_name: selectedAgent ? selectedAgent.full_name : null,
        assigned_agent: selectedAgent ? selectedAgent.full_name : null,
        notes: editInvoiceForm.notes.trim() || null,
        paid_amount: nextPaidAmount,
        paid_at:
          editInvoiceForm.status === 'PAID'
            ? invoiceToEdit.paid_at || new Date().toISOString()
            : null,
      });

      if (res.data) {
        setInvoices((prev) =>
          prev.map((row) => (row.id === invoiceToEdit.id ? { ...row, ...res.data } : row))
        );
      }

      showToast(`Invoice #${invoiceToEdit.invoice_no} updated!${restoreNote}`);
      setEditInvoiceError(null);
      setInvoiceToEdit(null);
      await fetchAllProfileData();
    } catch (err: any) {
      const msg = err?.message || 'Failed to update invoice.';
      setEditInvoiceError(msg);
      showToast(msg, 'error');
    } finally {
      setIsUpdatingInvoice(false);
    }
  };

  // Action 12: Open Delete Invoice Confirmation Modal (Tab 2)
  const handleOpenDeleteInvoice = (inv: SupabaseInvoice) => {
    if (!canEditDeleteLedger) {
      showToast('Permission required: Edit & Delete Invoice is disabled for your account.', 'error');
      return;
    }
    setDeleteInvoiceError(null);
    const linkedTxCount = transactions.filter((t) => t.invoice_id === inv.id).length;
    setDeleteLinkedPayments(linkedTxCount > 0);
    setInvoiceToDelete(inv);
  };

  // Action 13: Confirm Delete Invoice (+ Optional Linked Payment Transactions)
  const handleDeleteInvoice = async () => {
    if (!canEditDeleteLedger || !invoiceToDelete) return;
    setDeleteInvoiceError(null);
    setIsDeletingInvoice(true);
    try {
      const targetId = invoiceToDelete.id;
      const invNo = invoiceToDelete.invoice_no;
      const res = await deleteInvoiceApi(targetId, {
        deleteLinkedPayments,
      });
      setInvoices((prev) => prev.filter((row) => row.id !== targetId));
      const txNote =
        res.deletedPaymentsCount && res.deletedPaymentsCount > 0
          ? ` Also removed ${res.deletedPaymentsCount} linked payment receipt(s).`
          : '';
      showToast(`Invoice #${invNo} deleted.${txNote}`);
      setDeleteInvoiceError(null);
      setInvoiceToDelete(null);
      await fetchAllProfileData();
    } catch (err: any) {
      const msg = err?.message || 'Failed to delete invoice.';
      setDeleteInvoiceError(msg);
      showToast(msg, 'error');
    } finally {
      setIsDeletingInvoice(false);
    }
  };

  const isMikrotikDisabled =
    mikrotikSecret?.disabled === 'true' || mikrotikSecret?.disabled === true;
  const accountStatus =
    user?.account_status || (isMikrotikDisabled ? 'SUSPENDED' : 'ACTIVE');
  const effectivePackage =
    liveSecretProfile || mikrotikSecret?.profile || user?.package_speed || 'Standard Plan';
  const effectivePassword = user?.password || mikrotikSecret?.password || '';
  const isOnline = Boolean(activeSession);

  if (isAccessDenied) {
    return (
      <div className="space-y-4 animate-fade-in font-sans pb-12">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 rounded-xl text-xs font-bold transition cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
          <span>← Back to User Directory</span>
        </button>
        <div className="bg-slate-900 border border-rose-800/70 rounded-2xl p-8 text-center space-y-2.5 max-w-xl mx-auto">
          <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto" />
          <h2 className="text-lg font-bold text-white">Subscriber Outside Reseller Scope</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Account <span className="font-mono text-rose-300">@{cleanUsername}</span> does not belong to your Dealer or Sub-Dealer hierarchy. Access is restricted by multi-tier reseller isolation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in font-sans pb-12">
      {/* 1. TOP BREADCRUMB & HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 rounded-xl text-xs font-bold transition cursor-pointer shadow-sm active:scale-95"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />
            <span>← Back to User Directory</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
            <span>/</span>
            <span>Subscribers</span>
            <span>/</span>
            <span className="text-cyan-400 font-bold">@{cleanUsername}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-slate-900 border border-slate-800 text-slate-300">
            <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            <span>Youth Net 360° Profile</span>
          </span>

          <button
            type="button"
            onClick={fetchAllProfileData}
            disabled={isLoading}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-xl text-slate-300 hover:text-white transition cursor-pointer"
            title="Refresh All 360° Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Toast Banner */}
      {toastMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-mono flex items-center justify-between shadow-lg ${
            toastMessage.type === 'error'
              ? 'bg-rose-950/90 border-rose-800 text-rose-300'
              : 'bg-emerald-950/90 border-emerald-800 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. MAIN 360 TOP SECTION: LEFT IDENTITY PANEL + TOP RIGHT METRICS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT IDENTITY PANEL (5 Columns) */}
        <div className="lg:col-span-5 bg-[#111A2E] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
          {/* Header & Avatar */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-600 to-indigo-700 flex items-center justify-center font-bold text-xl text-white shadow-lg shadow-cyan-950/40">
                  {(user?.full_name || mikrotikSecret?.comment || cleanUsername || 'YN').slice(0, 2).toUpperCase()}
                </div>
                <span
                  className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#111A2E] flex items-center justify-center ${
                    isOnline ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                  title={isOnline ? 'Active Online Session' : 'Offline'}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-white animate-ping' : 'bg-slate-400'}`} />
                </span>
              </div>

              <div>
                <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                  <span>{user?.full_name || mikrotikSecret?.comment || mikrotikSecret?.name || cleanUsername || 'Subscriber Account'}</span>
                </h2>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-cyan-400 font-mono font-bold text-xs">@{cleanUsername}</span>
                  <button
                    onClick={() => copyToClipboard(cleanUsername, 'Username')}
                    className="text-slate-500 hover:text-slate-300 transition"
                    title="Copy Username"
                  >
                    {copiedField === 'Username' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Status Badges: Account Status & MikroTik Live Status */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider inline-flex items-center gap-1.5 border ${
                  accountStatus === 'ACTIVE'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                    : accountStatus === 'SUSPENDED'
                    ? 'bg-rose-950 text-rose-300 border-rose-800'
                    : 'bg-amber-950 text-amber-300 border-amber-800'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    accountStatus === 'ACTIVE' ? 'bg-emerald-400' : accountStatus === 'SUSPENDED' ? 'bg-rose-400' : 'bg-amber-400'
                  }`}
                />
                <span>{accountStatus}</span>
              </span>

              {/* MikroTik Live Connection Status */}
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold uppercase tracking-wider inline-flex items-center gap-1.5 border ${
                  activeSession
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                    : 'bg-rose-950/80 text-rose-300 border-rose-800/80'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    activeSession ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <span>{activeSession ? 'ONLINE' : 'OFFLINE'}</span>
              </span>
            </div>
          </div>

          {/* NET BALANCE CARD */}
          <div
            className={`p-3.5 rounded-xl border flex items-center justify-between ${
              netBalance > 0
                ? 'bg-rose-950/40 border-rose-800/80'
                : 'bg-emerald-950/30 border-emerald-800/70'
            }`}
          >
            <div>
              <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
                Net Balance / Arrears
              </span>
              <div
                className={`text-xl font-bold font-mono mt-0.5 ${
                  netBalance > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {formatCurrency(netBalance)}
              </div>
              <span className="text-[10px] text-slate-500">
                Invoiced: {formatCurrency(totalInvoiced)} • Paid: {formatCurrency(totalPaid)}
              </span>
            </div>

            {netBalance > 0 ? (
              <span className="px-2 py-1 rounded bg-rose-900/60 text-rose-300 text-[11px] font-bold font-mono border border-rose-700/60">
                Dues Pending
              </span>
            ) : (
              <span className="px-2 py-1 rounded bg-emerald-900/60 text-emerald-300 text-[11px] font-bold font-mono border border-emerald-700/60 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>Settled</span>
              </span>
            )}
          </div>

          {/* DETAILS METADATA LIST */}
          <div className="bg-slate-900/90 rounded-xl p-3.5 border border-slate-800 space-y-2.5 text-xs font-mono">
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">CNIC:</span>
              <span className="text-white font-bold">
                {perms.view_passwords
                  ? user?.cnic || 'N/A'
                  : user?.cnic
                  ? maskSensitiveCnic(user.cnic)
                  : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">Phone / WhatsApp:</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold">{user?.phone || 'N/A'}</span>
                {user?.phone && (
                  <a
                    href={buildWhatsAppUrl(user.phone, '')}
                    target="_blank"
                    rel="noopener noreferrer external"
                    className="p-1 rounded bg-emerald-950 text-emerald-400 hover:text-white transition"
                    title="Open WhatsApp"
                  >
                    <Send className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
            <div className="flex justify-between items-start">
              <span className="text-slate-400 font-sans">Installation Address:</span>
              <span className="text-white text-right max-w-[240px] font-sans text-xs">
                {user?.address || user?.area || 'N/A'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">Coverage Area:</span>
              <span className="text-cyan-400 font-bold">{user?.area || 'N/A'}</span>
            </div>
            {owningDealerLabel && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-sans">Assigned Reseller:</span>
                <span className="text-indigo-300 font-bold">{owningDealerLabel}</span>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">Installation Date:</span>
              <span className="text-slate-300">
                {extractYmdString(user?.installation_date || user?.created_at) || 'N/A'}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400 font-sans">Monthly Billing Cycle:</span>
              <span className="text-cyan-400 font-bold">
                Day {computeBillingAnchorDay(user || {})} &bull; Next Due:{' '}
                {extractYmdString(user?.next_billing_date || user?.expiry_date) ||
                  computeNextBillingDateFromInstall(user?.installation_date || user?.created_at)}
              </span>
            </div>

            {/* Password Toggle Row */}
            <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
              <span className="text-slate-400 font-sans">Portal &amp; PPPoE Pass:</span>
              <div className="flex items-center gap-2">
                {perms.view_passwords ? (
                  <>
                    <span className="text-white font-bold tracking-wider">
                      {showPassword ? effectivePassword || '••••••' : '••••••••'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-400 hover:text-white cursor-pointer"
                      title={showPassword ? 'Hide Password' : 'Show Password'}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(effectivePassword, 'Password')}
                      className="text-slate-400 hover:text-white cursor-pointer"
                      title="Copy Password"
                    >
                      {copiedField === 'Password' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </>
                ) : (
                  <span
                    className="text-slate-500 font-bold tracking-wider"
                    title="Reveal Subscriber PPPoE Passwords & CNIC permission is disabled"
                  >
                    ••••••••
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* THREE ACTION BUTTONS */}
          <div className={`grid gap-2 pt-1 ${perms.view_passwords ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <button
              type="button"
              onClick={() => setIsKickModalOpen(true)}
              className="px-2.5 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
              title="Terminate live PPPoE session from MikroTik core"
            >
              <WifiOff className="w-3.5 h-3.5 text-rose-400" />
              <span>Kick Session</span>
            </button>

            {perms.view_passwords && (
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(true)}
                className="px-2.5 py-2 rounded-xl bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-800 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
                title="Update secret password in Supabase and MikroTik"
              >
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Passwd</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsEditUserModalOpen(true)}
              className="px-2.5 py-2 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
              title="Modify subscriber profile and ONU hardware metadata"
            >
              <Edit className="w-3.5 h-3.5 text-cyan-400" />
              <span>Edit Profile</span>
            </button>
          </div>
        </div>

        {/* TOP RIGHT METRICS (Youth Net Card) (7 Columns) */}
        <div className="lg:col-span-7 bg-[#111A2E] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  YOUTH NET CARRIER TELEMETRY &amp; QUOTA
                </h3>
              </div>

              {/* Package Speed Badge bound from MikroTik /ppp/secret & portal_users */}
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-xl bg-indigo-950 text-indigo-300 border border-indigo-800 text-xs font-mono font-bold flex items-center gap-1.5 shadow-sm">
                  <Activity className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                  <span>{effectivePackage}</span>
                </span>
                <span className="text-slate-400 text-xs font-mono">
                  {formatCurrency(
                    user?.monthly_fee !== undefined && user?.monthly_fee !== null && Number(user.monthly_fee) > 0
                      ? Number(user.monthly_fee)
                      : resolvePackageRate(effectivePackage)
                  )}/mo
                </span>
              </div>
            </div>

            {/* DONUT USAGE CHART & REAL-TIME SPEED GAUGE GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {/* DONUT CHART (Data Usage) */}
              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 flex items-center gap-4">
                {/* SVG Circular Donut Chart */}
                <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    {/* Background Circle */}
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      stroke="currentColor"
                      strokeWidth="10"
                      className="text-slate-800"
                      fill="transparent"
                    />
                    {/* Progress Circle */}
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      stroke="currentColor"
                      strokeWidth="10"
                      className={usagePercentage > 85 ? 'text-rose-500' : 'text-cyan-400'}
                      fill="transparent"
                      strokeDasharray={2 * Math.PI * 40}
                      strokeDashoffset={2 * Math.PI * 40 * (1 - usagePercentage / 100)}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-lg font-bold font-mono text-white leading-none">
                      {usagePercentage}%
                    </span>
                    <span className="text-[9px] text-slate-400 uppercase mt-0.5">Used</span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs font-mono flex-1">
                  <span className="text-slate-400 block font-sans text-[11px] font-semibold">
                    Monthly FUP Allowance
                  </span>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Consumed:</span>
                    <span className="text-white font-bold">{consumedGb} GB</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Remaining Quota:</span>
                    <span className="text-emerald-400 font-bold">{remainingGb} GB</span>
                  </div>
                  <div className="pt-1 border-t border-slate-800 text-[10px] text-slate-500">
                    Total: {packageTotalGb} GB / cycle
                  </div>
                </div>
              </div>

              {/* REAL-TIME LIVE SPEED GAUGE (Youth Net Poller) */}
              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-sans font-bold text-slate-300 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>Real-Time Speed Gauge</span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    Live MikroTik API
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 my-2.5">
                  {/* Download Rx */}
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 font-mono block">RX DOWNLOAD</span>
                    <div className="text-lg font-bold font-mono text-cyan-400 mt-0.5">
                      {liveSpeed.rxMbps} <span className="text-xs text-slate-400 font-sans">Mbps</span>
                    </div>
                    {/* Visual Bar Meter */}
                    <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="bg-cyan-400 h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (liveSpeed.rxMbps / (parseInt(effectivePackage || '50', 10) || 50)) * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Upload Tx */}
                  <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-400 font-mono block">TX UPLOAD</span>
                    <div className="text-lg font-bold font-mono text-purple-400 mt-0.5">
                      {liveSpeed.txMbps} <span className="text-xs text-slate-400 font-sans">Mbps</span>
                    </div>
                    {/* Visual Bar Meter */}
                    <div className="w-full bg-slate-800 h-1.5 rounded-full mt-1.5 overflow-hidden">
                      <div
                        className="bg-purple-400 h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, (liveSpeed.txMbps / ((parseInt(effectivePackage || '50', 10) || 50) * 0.3)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-800/80">
                  <span>Polling: 3.5s cycle</span>
                  <span className="text-emerald-400">Low-Latency BNG Feed</span>
                </div>
              </div>
            </div>
          </div>

          {/* QUICK HARDWARE BADGES BAR */}
          <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
              <span>ONU: <strong className="text-white">{user?.onu_device_model || 'Not Recorded'}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span>MAC: <strong className="text-white">{user?.onu_mac || activeSession?.callerId || mikrotikSecret?.['last-caller-id'] || 'Not Recorded'}</strong></span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-400" />
              <span>FAT: <strong className="text-white">{user?.fiber_box_location || gisFdbLocation || 'Not Assigned'}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. TABBED SECTIONS (Youth Net Layout) */}
      <div className="bg-[#111A2E] border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        {/* TAB HEADERS */}
        <div className="flex items-center overflow-x-auto border-b border-slate-800 bg-slate-900/60 p-2 gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'inventory'
                ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>1. Service &amp; Hardware Inventory ({inventoryLogs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ledger')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'ledger'
                ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>2. Ledger &amp; Invoices ({invoices.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('connection')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'connection'
                ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <History className="w-4 h-4" />
            <span>3. Connection &amp; Live Logs ({sessionLogs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tickets')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer whitespace-nowrap ${
              activeTab === 'tickets'
                ? 'bg-cyan-600 text-slate-950 shadow-md shadow-cyan-950/50'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <MessageSquareWarning className="w-4 h-4" />
            <span>4. Complaints &amp; SLA ({tickets.length})</span>
          </button>
        </div>

        {/* TAB 1: SERVICE & HARDWARE INVENTORY */}
        {activeTab === 'inventory' && (
          <div className="p-5 space-y-5">
            {/* ONU & Physical Wire Specifications */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono block">ONU DEVICE MODEL</span>
                <span className="font-bold text-white text-xs mt-1 block truncate">
                  {user?.onu_device_model || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono block">ONU MAC ADDRESS</span>
                <span className="font-bold text-cyan-400 font-mono text-xs mt-1 block truncate">
                  {user?.onu_mac || activeSession?.callerId || mikrotikSecret?.['last-caller-id'] || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono block">PON SERIAL NO</span>
                <span className="font-bold text-purple-400 font-mono text-xs mt-1 block truncate">
                  {user?.onu_pon_serial || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono block">DROP WIRE LENGTH</span>
                <span className="font-bold text-emerald-400 font-mono text-xs mt-1 block">
                  {user?.drop_wire_meters !== undefined && user?.drop_wire_meters !== null ? `${user.drop_wire_meters} meters` : 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono block">FIBER BOX (FAT / DP)</span>
                <span className="font-bold text-amber-400 font-mono text-xs mt-1 block truncate">
                  {user?.fiber_box_location || gisFdbLocation || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[10px] text-slate-400 font-mono block">PATCH CORDS ISSUED</span>
                <span className="font-bold text-white font-mono text-xs mt-1 block">
                  {user?.patch_cord_qty !== undefined && user?.patch_cord_qty !== null ? `${user.patch_cord_qty} Units` : 'N/A'}
                </span>
              </div>
            </div>

            {/* Inventory Logs Header & Add Material Button */}
            <div className="flex items-center justify-between pt-2">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-cyan-400" />
                  <span>Maintenance Material &amp; Hardware Logs (`subscriber_inventory_logs`)</span>
                </h4>
                <p className="text-slate-400 text-xs mt-0.5">
                  Audit trail of FTTH physical drop cables, connectors, power adapters, and field technician materials.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsAddMaterialModalOpen(true)}
                className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-md shadow-cyan-950/50 cursor-pointer active:scale-95"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span>+ Add Material / Wire Charge</span>
              </button>
            </div>

            {/* Inventory Table */}
            <div className="rounded-xl border border-slate-800 overflow-x-auto bg-slate-900/60">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase font-mono text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Item Name</th>
                    <th className="py-3 px-4 text-center">Quantity</th>
                    <th className="py-3 px-4 text-right">Unit Cost</th>
                    <th className="py-3 px-4 text-right">Total Charge</th>
                    <th className="py-3 px-4 text-center">Added to Invoice</th>
                    <th className="py-3 px-4">Installed By</th>
                    <th className="py-3 px-4 text-right">Date</th>
                    {canEditDeleteLedger && (
                      <th className="py-3 px-4 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {inventoryLogs.length === 0 ? (
                    <tr>
                      <td colSpan={canEditDeleteLedger ? 8 : 7} className="py-8 text-center text-slate-500 font-mono">
                        No maintenance materials logged yet for @{cleanUsername}. Click "+ Add Material / Wire Charge" above.
                      </td>
                    </tr>
                  ) : (
                    inventoryLogs.map((log) => {
                      const totalCost = Number(log.quantity) * Number(log.unit_cost);
                      return (
                        <tr key={log.id} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 font-bold text-white">{log.item_name}</td>
                          <td className="py-3 px-4 text-center font-mono font-semibold">{log.quantity}</td>
                          <td className="py-3 px-4 text-right font-mono">{formatCurrency(log.unit_cost)}</td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-white">
                            {formatCurrency(totalCost)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {log.added_to_invoice ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>Billed</span>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                                Inventory Only
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-cyan-400">{log.installed_by_agent_name || 'NOC'}</td>
                          <td className="py-3 px-4 text-right font-mono text-slate-400 whitespace-nowrap">
                            {log.created_at ? new Date(log.created_at).toLocaleDateString() : 'N/A'}
                          </td>
                          {canEditDeleteLedger && (
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditMaterial(log)}
                                  title="Edit Material Entry"
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600/30 border border-slate-700 hover:border-indigo-500/60 text-indigo-300 transition cursor-pointer"
                                >
                                  <Edit className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeleteMaterialError(null);
                                    setMaterialToDelete(log);
                                  }}
                                  title="Delete Material Entry"
                                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/30 border border-slate-700 hover:border-rose-500/60 text-rose-300 transition cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
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
        )}

        {/* TAB 2: LEDGER & INVOICES */}
        {activeTab === 'ledger' && (
          <div className="p-5 space-y-6">
            {/* Financial Summary KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[11px] font-mono text-slate-400 uppercase">Total Invoiced Amount</span>
                <div className="text-2xl font-bold font-mono text-white mt-1">
                  {formatCurrency(totalInvoiced)}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">{invoices.length} invoices generated</span>
              </div>

              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[11px] font-mono text-slate-400 uppercase">Total Collected / Paid</span>
                <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
                  {formatCurrency(totalPaid)}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">{transactions.length} receipts verified</span>
              </div>

              <div className="p-4 bg-slate-900 rounded-xl border border-slate-800">
                <span className="text-[11px] font-mono text-slate-400 uppercase">Outstanding Balance Due</span>
                <div className={`text-2xl font-bold font-mono mt-1 ${netBalance > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {formatCurrency(netBalance)}
                </div>
                <span className="text-[11px] text-slate-500 mt-1 block">
                  {netBalance > 0 ? 'Arrears pending collection' : 'Account zeroed / settled'}
                </span>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <span>Generated Invoices (`invoices`)</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsGenerateInvoiceModalOpen(true)}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg text-xs flex items-center gap-1.5 transition active:scale-95 shadow cursor-pointer"
                  title="Generate Invoice for this Subscriber"
                >
                  <Plus className="w-3.5 h-3.5 stroke-[3]" />
                  <span>+ Generate Invoice</span>
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/60">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase font-mono text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Invoice #</th>
                      <th className="py-3 px-4">Due Date</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4 text-right">Paid</th>
                      <th className="py-3 px-4 text-right">Balance</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4">Assigned Agent</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {invoices.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-500 font-mono">
                          No invoices generated yet for @{cleanUsername}.
                        </td>
                      </tr>
                    ) : (
                      invoices.map((inv) => {
                        const totalAmount = Number(inv.amount || 0);
                        const alreadyPaid = Number(inv.paid_amount || 0);
                        const balance = Math.max(0, totalAmount - alreadyPaid);
                        const displayStatus = balance === 0 ? 'PAID' : (inv.status || 'DUE').toUpperCase();
                        const isPaid = displayStatus === 'PAID';
                        const isPartial = displayStatus === 'PARTIAL';

                        return (
                          <tr key={inv.id} className="hover:bg-slate-800/40 transition">
                            <td className="py-3 px-4 font-mono font-bold text-cyan-400">{inv.invoice_no}</td>
                            <td className="py-3 px-4 font-mono text-slate-400">{inv.due_date}</td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-white">
                              {formatCurrency(totalAmount)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-emerald-400">
                              {formatCurrency(alreadyPaid)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-rose-400">
                              {formatCurrency(balance)}
                            </td>
                            <td className="py-3 px-4 text-center">
                              {displayStatus === 'PAID' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  PAID
                                </span>
                              ) : displayStatus === 'PARTIAL' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                  PARTIAL
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                  DUE
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-400">
                              {inv.assigned_agent_name || 'Unassigned'}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-1.5">
                                {balance > 0 && displayStatus !== 'PAID' ? (
                                  perms.collect_fee ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setSelectedInvoiceForPayment(inv);
                                        setPaymentAmountInput(balance);
                                        setIsRecordPaymentModalOpen(true);
                                      }}
                                      className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-[11px] transition cursor-pointer"
                                    >
                                      Record Payment
                                    </button>
                                  ) : (
                                    <span className="text-slate-500 font-mono text-[11px]">Unpaid</span>
                                  )
                                ) : (
                                  <>
                                    <span className="text-emerald-400 font-mono text-[11px] font-semibold">
                                      ✓ Paid
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => onOpenReceiptModal?.(inv)}
                                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 text-[11px] transition cursor-pointer flex items-center gap-1"
                                    >
                                      <Printer className="w-3 h-3" />
                                      <span>Receipt</span>
                                    </button>
                                  </>
                                )}
                                {canEditDeleteLedger && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenEditInvoice(inv)}
                                      title={`Edit Invoice ${inv.invoice_no}`}
                                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-indigo-600/30 border border-slate-700 hover:border-indigo-500/60 text-indigo-300 transition cursor-pointer"
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenDeleteInvoice(inv)}
                                      title={`Delete Invoice ${inv.invoice_no}`}
                                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/30 border border-slate-700 hover:border-rose-500/60 text-rose-300 transition cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payment Receipts Table */}
            <div className="space-y-2 pt-2">
              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-400" />
                <span>Verified Payment Transactions (`payment_transactions`)</span>
              </h4>

              <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/60">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase font-mono text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Receipt Date</th>
                      <th className="py-3 px-4 text-right">Amount Paid</th>
                      <th className="py-3 px-4">Payment Mode</th>
                      <th className="py-3 px-4">Collected By</th>
                      <th className="py-3 px-4">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-500 font-mono">
                          No payment transactions recorded yet.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => (
                        <tr key={tx.id || Math.random()} className="hover:bg-slate-800/40 transition">
                          <td className="py-3 px-4 font-mono text-slate-400">
                            {tx.payment_date || tx.created_at ? new Date(tx.payment_date || tx.created_at || '').toLocaleString() : 'N/A'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-400">
                            {formatCurrency(tx.amount_paid)}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[10px]">
                              {tx.payment_mode || tx.payment_method || 'Cash Handover'}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-cyan-400">{tx.collected_by_name || 'NOC Billing'}</td>
                          <td className="py-3 px-4 text-slate-400 text-xs">{tx.notes || 'Settlement verified'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CONNECTION & LIVE LOGS */}
        {activeTab === 'connection' && (
          <div className="p-5 space-y-6">
            {/* Live RouterOS Active Session Card */}
            <div className="p-4 bg-slate-900 rounded-xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`w-3 h-3 rounded-full ${
                      isOnline ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'
                    }`}
                  />
                  <h4 className="text-sm font-bold text-white font-mono">
                    RouterOS PPPoE Active Session: {isOnline ? 'ONLINE' : 'OFFLINE'}
                  </h4>
                </div>

                {isOnline && (
                  <button
                    type="button"
                    onClick={() => setIsKickModalOpen(true)}
                    className="px-3 py-1 bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 rounded-lg text-xs font-bold transition flex items-center gap-1 cursor-pointer"
                  >
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>Disconnect Active Session</span>
                  </button>
                )}
              </div>

              {isOnline && activeSession ? (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                    <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">ASSIGNED IP</span>
                      <span className="text-cyan-400 font-bold mt-0.5 block">{activeSession.address}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">CALLER-ID / MAC</span>
                      <span className="text-white font-bold mt-0.5 block">{activeSession.callerId}</span>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">SESSION UPTIME</span>
                      <span className="text-emerald-400 font-bold mt-0.5 block">
                        {formatDurationHms(parseRouterOsUptimeSeconds(activeSession.uptime))}
                      </span>
                    </div>
                    <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">PROTOCOL / SERVICE</span>
                      <span className="text-purple-400 font-bold mt-0.5 block">{activeSession.service || 'pppoe'}</span>
                    </div>
                  </div>

                  {/* Real-time Session Transferred Telemetry */}
                  <div className="p-3 bg-slate-950 rounded-lg border border-cyan-900/60 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                      <span className="text-slate-300 font-bold">RouterOS Live Transferred Data:</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div>
                        <span className="text-slate-400 text-[10px] block">DOWNLOAD (RX)</span>
                        <span className="text-emerald-400 font-bold font-mono text-sm">
                          {activeSession.gbIn || '0.00'} GB
                        </span>
                      </div>
                      <span className="text-slate-700">|</span>
                      <div>
                        <span className="text-slate-400 text-[10px] block">UPLOAD (TX)</span>
                        <span className="text-cyan-400 font-bold font-mono text-sm">
                          {activeSession.gbOut || '0.00'} GB
                        </span>
                      </div>
                      <span className="text-slate-700">|</span>
                      <div>
                        <span className="text-slate-400 text-[10px] block">TOTAL SESSION USAGE</span>
                        <span className="text-purple-400 font-bold font-mono text-sm">
                          {(Number(activeSession.gbIn || 0) + Number(activeSession.gbOut || 0)).toFixed(2)} GB
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-slate-950 rounded-lg text-xs text-slate-400 font-mono">
                  Subscriber @{cleanUsername} is currently disconnected from the physical BNG router. No active interface lock.
                </div>
              )}
            </div>

            {/* Historical Session Logs */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <History className="w-4 h-4 text-purple-400" />
                    <span>Persisted PPPoE Session Audit Log (`subscriber_session_logs`)</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Real-time connect, 60s telemetry checkpoint, reconnect, disconnect, and NOC kick records.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchAllProfileData}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono flex items-center gap-1.5 cursor-pointer transition"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>Refresh Logs</span>
                </button>
              </div>

              <div className="rounded-xl border border-slate-800 overflow-x-auto bg-slate-900/60">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase font-mono text-[11px]">
                    <tr>
                      <th className="py-3 px-4">DC Reason / Status</th>
                      <th className="py-3 px-4">Login</th>
                      <th className="py-3 px-4">Logoff</th>
                      <th className="py-3 px-4">Uptime</th>
                      <th className="py-3 px-4 text-right">Data Used</th>
                      <th className="py-3 px-4">MAC Address</th>
                      <th className="py-3 px-4">IP Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {sessionLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 font-mono">
                          No persisted session logs recorded yet for @{cleanUsername}.
                        </td>
                      </tr>
                    ) : (
                      sessionLogs.map((sess) => {
                        const rawStatus = (
                          sess.session_status ||
                          (sess.disconnected_at ? 'DISCONNECTED' : 'ACTIVE')
                        ).toUpperCase();
                        const isRowActive =
                          rawStatus === 'ACTIVE' && !sess.disconnected_at && isOnline;

                        const loginIso = sess.connected_at || sess.recorded_at || null;
                        const logoffIso = isRowActive
                          ? null
                          : sess.disconnected_at || sess.recorded_at || null;

                        const uptimeSec =
                          isRowActive && activeSession
                            ? parseRouterOsUptimeSeconds(activeSession.uptime) ||
                              computeExactSessionUptimeSeconds(
                                loginIso,
                                new Date().toISOString(),
                                sess.uptime_seconds,
                                sess.uptime_duration
                              )
                            : computeExactSessionUptimeSeconds(
                                loginIso,
                                logoffIso,
                                sess.uptime_seconds,
                                sess.uptime_duration
                              );
                        const uptimeHms = formatDurationHms(uptimeSec);

                        const reasonLabel = isRowActive
                          ? 'ONLINE (Active)'
                          : formatDisconnectReasonBadge(sess.disconnect_reason, rawStatus);

                        const rawBytesIn =
                          isRowActive && activeSession
                            ? Math.max(Number(sess.bytes_in || 0), Number(activeSession.rawBytesIn || 0))
                            : Number(sess.bytes_in || 0);
                        const rawBytesOut =
                          isRowActive && activeSession
                            ? Math.max(Number(sess.bytes_out || 0), Number(activeSession.rawBytesOut || 0))
                            : Number(sess.bytes_out || 0);

                        const badgeStyle = isRowActive
                          ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700/80'
                          : reasonLabel === 'Admin-Reset'
                          ? 'bg-rose-950/90 text-rose-300 border-rose-700/80'
                          : reasonLabel === 'Peer-Not-Responding' || reasonLabel === 'Lost-Carrier'
                          ? 'bg-amber-950/90 text-amber-300 border-amber-700/80'
                          : reasonLabel === 'User-Request'
                          ? 'bg-cyan-950/90 text-cyan-300 border-cyan-700/80'
                          : 'bg-slate-800 text-slate-300 border-slate-700';

                        return (
                          <tr
                            key={sess.id || `${sess.recorded_at}-${sess.session_id}`}
                            className="hover:bg-slate-800/40 transition"
                          >
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold inline-flex items-center gap-1.5 border ${badgeStyle}`}
                              >
                                {isRowActive && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                )}
                                {reasonLabel}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-slate-200 whitespace-nowrap">
                              {formatRadiusDateTime(loginIso)}
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                              {isRowActive ? (
                                <span className="text-emerald-400 font-bold">Active Now</span>
                              ) : (
                                <span className="text-slate-300">{formatRadiusDateTime(logoffIso)}</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-white font-semibold tabular-nums whitespace-nowrap">
                              {uptimeHms}
                            </td>
                            <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                              <div className="font-bold text-cyan-400">
                                ↓ {formatBytesTransfer(rawBytesIn)}
                              </div>
                              <div className="text-[11px] text-purple-400">
                                ↑ {formatBytesTransfer(rawBytesOut)}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-300 whitespace-nowrap">
                              {sess.mac_address || user?.onu_mac || 'N/A'}
                            </td>
                            <td className="py-3 px-4 font-mono text-cyan-400 whitespace-nowrap">
                              {sess.ip_address || 'Dynamic IP'}
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

        {/* TAB 4: COMPLAINTS & SLA */}
        {activeTab === 'tickets' && (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <MessageSquareWarning className="w-4 h-4 text-amber-400" />
                  <span>Complaints &amp; Support Tickets (`tickets`)</span>
                </h4>
                <p className="text-slate-400 text-xs mt-0.5">
                  Live SLA tracking, optical power alarms, fiber fault complaints, and technician dispatch history.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsNewTicketModalOpen(true)}
                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-xl text-xs transition flex items-center gap-1.5 shadow-md shadow-amber-950/50 cursor-pointer active:scale-95"
              >
                <Plus className="w-3.5 h-3.5 stroke-[3]" />
                <span>+ Log New Complaint Ticket</span>
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/60">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900 text-slate-400 border-b border-slate-800 uppercase font-mono text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Ticket #</th>
                    <th className="py-3 px-4">Issue / Complaint</th>
                    <th className="py-3 px-4 text-center">Priority</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4">Assigned Agent</th>
                    <th className="py-3 px-4 text-right">Reporting Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {tickets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 font-mono">
                        No support tickets or complaints recorded for @{cleanUsername}. All services optimal!
                      </td>
                    </tr>
                  ) : (
                    tickets.map((tkt) => (
                      <tr key={tkt.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3 px-4 font-mono font-bold text-amber-400">{tkt.ticket_no}</td>
                        <td className="py-3 px-4 font-semibold text-white max-w-[280px]">{tkt.issue}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              tkt.priority === 'CRITICAL'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : tkt.priority === 'HIGH'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-slate-800 text-slate-300 border border-slate-700'
                            }`}
                          >
                            {tkt.priority}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {tkt.status === 'RESOLVED' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span>RESOLVED</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800 animate-pulse">
                              <Clock className="w-3 h-3 text-rose-400" />
                              <span>OPEN</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-cyan-400">{tkt.assigned_agent_name || 'NOC Field Tech'}</td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400">
                          {tkt.created_at ? new Date(tkt.created_at).toLocaleDateString() : 'N/A'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* MODAL 1: KICK / DISCONNECT CONFIRMATION */}
      {isKickModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-[#111A2E] border border-rose-800 p-4 sm:p-5 shadow-2xl relative">
            <div className="flex items-center gap-2.5 text-rose-400 pb-3 border-b border-slate-800">
              <WifiOff className="w-5 h-5 text-rose-400" />
              <h3 className="text-base font-bold text-white">Disconnect PPPoE Session?</h3>
            </div>
            <p className="text-xs text-slate-300 mt-3 leading-relaxed">
              This will send an instant tear-down signal to the physical MikroTik BNG router for user <strong className="text-white font-mono">@{cleanUsername}</strong>.
              The active tunnel interface will be terminated, prompting the ONT to re-authenticate.
            </p>
            <div className="flex items-center justify-end gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => setIsKickModalOpen(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleKickSession}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition shadow cursor-pointer"
              >
                Confirm Disconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: CHANGE PASSWORD */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-[#111A2E] border border-slate-700 p-4 sm:p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <span>Update Secret Password</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsPasswordModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdatePassword} className="space-y-3.5 mt-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new credential"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Confirm Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new credential"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="p-2.5 bg-amber-950/40 border border-amber-900/60 rounded-lg text-[11px] text-amber-300 flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Updates password in Supabase `portal_users` and dispatches update to `/ppp/secret`.</span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingPassword}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-lg text-xs transition shadow flex items-center gap-1.5 cursor-pointer font-mono"
                >
                  {isUpdatingPassword ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <span>Update &amp; Sync</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT CUSTOMER & HARDWARE METADATA */}
      {isEditUserModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-[#111A2E] border border-slate-700 p-4 sm:p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Edit className="w-4 h-4 text-cyan-400" />
                <span>Edit Subscriber &amp; Hardware Details</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditUserModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCustomer} className="space-y-4 mt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={editForm.fullName}
                    onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Phone Number</label>
                  <input
                    type="text"
                    required
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">CNIC Number</label>
                  <input
                    type="text"
                    disabled={!perms.view_passwords}
                    value={
                      perms.view_passwords
                        ? editForm.cnic
                        : editForm.cnic
                        ? maskSensitiveCnic(editForm.cnic)
                        : 'Masked'
                    }
                    onChange={(e) => {
                      if (!perms.view_passwords) return;
                      setEditForm({ ...editForm, cnic: e.target.value });
                    }}
                    placeholder="37405-XXXXXXX-X"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Account Status</label>
                  <select
                    value={editForm.accountStatus}
                    onChange={(e) => setEditForm({ ...editForm, accountStatus: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="EXPIRED">EXPIRED</option>
                    <option value="SUSPENDED">SUSPENDED</option>
                  </select>
                </div>
              </div>

              {isAdminSession && (
                <div className="p-3 bg-indigo-950/30 rounded-xl border border-indigo-500/30 space-y-1.5">
                  <label className="block font-semibold text-indigo-300">
                    Assigned Dealer / Sub-Dealer (Subscriber Ownership)
                  </label>
                  <select
                    value={editForm.assignedOwnerId}
                    onChange={(e) =>
                      setEditForm({ ...editForm, assignedOwnerId: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-slate-950 border border-indigo-500/40 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Master Direct ISP (No Dealer / Direct Subscriber)</option>
                    {allResellers
                      .filter((r) => getResellerTier(r) === 'DEALER')
                      .map((d) => (
                        <React.Fragment key={d.id}>
                          <option value={d.id}>
                            [Dealer] {d.full_name || d.username} (@{d.username})
                          </option>
                          {allResellers
                            .filter((s) => s.parent_dealer_id === d.id)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                &nbsp;&nbsp;↳ [Sub-Dealer] {s.full_name || s.username} (@{s.username})
                              </option>
                            ))}
                        </React.Fragment>
                      ))}
                    {allResellers
                      .filter((r) => getResellerTier(r) === 'SUB_DEALER' && !r.parent_dealer_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          [Sub-Dealer] {s.full_name || s.username} (@{s.username})
                        </option>
                      ))}
                  </select>
                  <p className="text-[10px] text-slate-400">
                    Reassigning ownership updates both the subscriber profile and their invoices to enforce strict Dealer / Sub-Dealer isolation.
                  </p>
                </div>
              )}

              <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 space-y-1.5">
                <label className="block font-medium text-slate-300">
                  Installation Date (Monthly Billing Anchor)
                </label>
                <input
                  type="date"
                  required
                  value={editForm.installationDate}
                  onChange={(e) => setEditForm({ ...editForm, installationDate: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                />
                <div className="text-[11px] font-mono text-cyan-400 pt-0.5">
                  Monthly Billing Day: <strong className="text-white">{editAnchorDay}</strong> of every month &bull; Next Due Date:{' '}
                  <strong className="text-emerald-400">{editNextBillingPreview}</strong>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Installation Address</label>
                  <input
                    type="text"
                    value={editForm.address}
                    onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <AreaNodeSelector
                  label="Area / Child Node"
                  value={editForm.area}
                  onChange={(area) => setEditForm({ ...editForm, area })}
                  areas={networkAreas}
                  onAreasUpdated={setNetworkAreas}
                  compact
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Package Speed</label>
                  <input
                    type="text"
                    value={editForm.packageSpeed}
                    onChange={(e) => setEditForm({ ...editForm, packageSpeed: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Monthly Fee (Rs.)</label>
                  <input
                    type="number"
                    value={editForm.monthlyFee}
                    onChange={(e) => setEditForm({ ...editForm, monthlyFee: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Volume Quota (GB)</label>
                  <input
                    type="number"
                    value={editForm.packageVolumeGb}
                    onChange={(e) => setEditForm({ ...editForm, packageVolumeGb: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* Hardware specifications section */}
              <div className="pt-2 border-t border-slate-800 space-y-3">
                <span className="font-bold text-cyan-400 uppercase tracking-wider text-[11px] block">
                  FTTH Optical Hardware Metadata
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">ONU Model</label>
                    <input
                      type="text"
                      value={editForm.onuDeviceModel}
                      onChange={(e) => setEditForm({ ...editForm, onuDeviceModel: e.target.value })}
                      placeholder="e.g. Huawei EchoLife HG8546M"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">ONU MAC Address</label>
                    <input
                      type="text"
                      value={editForm.onuMac}
                      onChange={(e) => setEditForm({ ...editForm, onuMac: e.target.value })}
                      placeholder="48:8A:D2:XX:XX:XX"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">PON Serial Number</label>
                    <input
                      type="text"
                      value={editForm.onuPonSerial}
                      onChange={(e) => setEditForm({ ...editForm, onuPonSerial: e.target.value })}
                      placeholder="e.g. HWTC-E97A124B"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Fiber Box / DP Location</label>
                    <input
                      type="text"
                      value={editForm.fiberBoxLocation}
                      onChange={(e) => setEditForm({ ...editForm, fiberBoxLocation: e.target.value })}
                      placeholder="FAT-F8-DP#04"
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Drop Wire Length (Meters)</label>
                    <input
                      type="number"
                      value={editForm.dropWireMeters}
                      onChange={(e) => setEditForm({ ...editForm, dropWireMeters: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Patch Cords Quantity</label>
                    <input
                      type="number"
                      value={editForm.patchCordQty}
                      onChange={(e) => setEditForm({ ...editForm, patchCordQty: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              </div>

              {editRequiresWalletGate && activeOwnerResellerId && (
                <ResellerWalletGatePreview
                  resellerId={activeOwnerResellerId}
                  subscriberUsername={cleanUsername}
                  profileName={editForm.packageSpeed}
                  actionLabel="package update"
                  compact
                  onStatusChange={setEditWalletStatus}
                />
              )}

              {editWalletError && (
                <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{editWalletError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditWalletError(null);
                    setIsEditUserModalOpen(false);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    isSavingEdit || Boolean(editRequiresWalletGate && editWalletStatus?.blocked)
                  }
                  className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold rounded-lg transition shadow flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingEdit ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : editRequiresWalletGate && editWalletStatus?.blocked ? (
                    <>
                      <AlertTriangle className="w-4 h-4" />
                      <span>Wallet Payment Gate Blocked</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: ADD MATERIAL / WIRE CHARGE (TAB 1) */}
      {isAddMaterialModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-[#111A2E] border border-slate-700 p-4 sm:p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Wrench className="w-4 h-4 text-cyan-400" />
                <span>+ Add Maintenance Material / Wire Charge</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddMaterialModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMaterial} className="space-y-3.5 mt-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Select Hardware / Material</label>
                <select
                  value={materialForm.itemName}
                  onChange={(e) => {
                    const val = e.target.value;
                    let suggestedCost = 35;
                    if (val.includes('Drop Wire')) suggestedCost = 35;
                    else if (val.includes('Connector')) suggestedCost = 150;
                    else if (val.includes('Power Adapter')) suggestedCost = 650;
                    else if (val.includes('FAT') || val.includes('Box')) suggestedCost = 1200;
                    else if (val.includes('Patch Cord')) suggestedCost = 250;
                    setMaterialForm({
                      ...materialForm,
                      itemName: val,
                      unitCost: suggestedCost,
                    });
                  }}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="2-Core FTTH Drop Wire Cable">2-Core FTTH Drop Wire Cable (per meter)</option>
                  <option value="SC/UPC Fiber Fast Connector">SC/UPC Fiber Fast Connector (unit)</option>
                  <option value="12V 1.5A Replacement Power Adapter">12V 1.5A Replacement Power Adapter</option>
                  <option value="Fiber Termination Box (FAT / Rosette)">Fiber Termination Box (FAT / Rosette)</option>
                  <option value="FTTH Simplex Patch Cord 3m">FTTH Simplex Patch Cord 3m</option>
                  <option value="Custom">Custom Maintenance Charge...</option>
                </select>
              </div>

              {materialForm.itemName === 'Custom' && (
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Custom Item Description</label>
                  <input
                    type="text"
                    required
                    value={materialForm.customItemName}
                    onChange={(e) => setMaterialForm({ ...materialForm, customItemName: e.target.value })}
                    placeholder="e.g. Splicing Machine Service Charge"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Quantity (Meters / Units)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={materialForm.quantity}
                    onChange={(e) => setMaterialForm({ ...materialForm, quantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Unit Cost (PKR)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={materialForm.unitCost}
                    onChange={(e) => setMaterialForm({ ...materialForm, unitCost: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Installed By (Field Agent)</label>
                <select
                  value={materialForm.installedByAgent}
                  onChange={(e) => setMaterialForm({ ...materialForm, installedByAgent: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                >
                  <option value="">-- Select Field Technician --</option>
                  {portalAgents.map((ag) => (
                    <option key={ag.id} value={ag.full_name}>
                      {ag.full_name} ({ag.area})
                    </option>
                  ))}
                </select>
              </div>

              {/* Total Charge & Append to Invoice Checkbox */}
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2">
                <div className="flex justify-between items-center text-xs font-mono">
                  <span className="text-slate-400">Total Material Charge:</span>
                  <span className="text-white font-bold text-sm">
                    {formatCurrency(Number(materialForm.quantity) * Number(materialForm.unitCost))}
                  </span>
                </div>

                <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-slate-800 text-xs">
                  <input
                    type="checkbox"
                    checked={materialForm.appendToInvoice}
                    onChange={(e) => setMaterialForm({ ...materialForm, appendToInvoice: e.target.checked })}
                    className="w-4 h-4 rounded text-cyan-600 focus:ring-0 bg-slate-800 border-slate-700 cursor-pointer"
                  />
                  <span className="text-slate-200">
                    Append charge to current unpaid invoice (increments balance due)
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddMaterialModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingMaterial}
                  className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded-lg transition shadow flex items-center gap-1.5 cursor-pointer font-mono"
                >
                  {isSavingMaterial ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Confirm &amp; Log Material</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 5: LOG NEW COMPLAINT TICKET (TAB 4) */}
      {isNewTicketModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto animate-fade-in font-sans">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-[#111A2E] border border-slate-700 p-4 sm:p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MessageSquareWarning className="w-4 h-4 text-amber-400" />
                <span>+ Log New Service Complaint Ticket</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsNewTicketModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTicket} className="space-y-3.5 mt-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Issue / Fault Description</label>
                <textarea
                  rows={3}
                  required
                  value={ticketForm.issue}
                  onChange={(e) => setTicketForm({ ...ticketForm, issue: e.target.value })}
                  placeholder="Describe optical line problem, red LOS, high latency, or physical fiber break..."
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500 font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">SLA Priority</label>
                  <select
                    value={ticketForm.priority}
                    onChange={(e) => setTicketForm({ ...ticketForm, priority: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-300 mb-1">Assign Field Agent</label>
                  <select
                    value={ticketForm.assignedAgentName}
                    onChange={(e) => setTicketForm({ ...ticketForm, assignedAgentName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">-- Select Field Agent --</option>
                    {portalAgents.map((ag) => (
                      <option key={ag.id} value={ag.full_name}>
                        {ag.full_name} ({ag.area})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewTicketModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingTicket}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-lg transition shadow flex items-center gap-1.5 cursor-pointer font-mono"
                >
                  {isSavingTicket ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Dispatching...</span>
                    </>
                  ) : (
                    <span>Submit &amp; Dispatch</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 6: QUICK RECORD PAYMENT (TAB 2) */}
      {isRecordPaymentModalOpen &&
        selectedInvoiceForPayment &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: '100vw',
              height: '100dvh',
              zIndex: 999999,
            }}
            className="bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 overflow-y-auto font-sans"
          >
            <div
              style={{ width: '100%', maxWidth: '390px', maxHeight: '88dvh' }}
              className="mobile-safe-modal overflow-y-auto overflow-x-hidden rounded-2xl p-4 box-border mx-auto bg-[#111A2E] border border-slate-700 shadow-2xl relative text-base"
            >
              <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 w-full min-w-0">
                <h3 className="text-base font-bold text-white flex items-center gap-2 min-w-0 truncate">
                  <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="truncate">Record Invoice Payment</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setIsRecordPaymentModalOpen(false)}
                  className="text-slate-400 hover:text-white shrink-0 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3.5 mt-4 w-full min-w-0">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1.5 font-mono text-xs w-full min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Invoice:</span>
                    <span className="text-cyan-400 font-bold truncate">
                      #{selectedInvoiceForPayment.invoice_no}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Total Amount:</span>
                    <span className="text-white">
                      {formatCurrency(selectedInvoiceForPayment.amount)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Already Paid:</span>
                    <span className="text-emerald-400">
                      {formatCurrency(selectedInvoiceForPayment.paid_amount || 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 pt-1 border-t border-slate-800 font-bold text-sm">
                    <span className="text-amber-400">Balance Due:</span>
                    <span className="text-amber-400">
                      {formatCurrency(
                        Math.max(
                          0,
                          Number(selectedInvoiceForPayment.amount) -
                            Number(selectedInvoiceForPayment.paid_amount || 0)
                        )
                      )}
                    </span>
                  </div>
                </div>

                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Payment Received (Rs.)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={paymentAmountInput}
                    onChange={(e) => setPaymentAmountInput(e.target.value)}
                    className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono text-base focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Collecting Agent
                  </label>
                  <select
                    value={collectingAgentInput}
                    onChange={(e) => setCollectingAgentInput(e.target.value)}
                    className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-base focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">-- Direct NOC / Bank --</option>
                    {portalAgents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.full_name} ({ag.area})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="w-full min-w-0">
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={paymentModeInput}
                    onChange={(e) => setPaymentModeInput(e.target.value)}
                    className="w-full min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white text-base focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Cash Handover">Cash Handover</option>
                    <option value="JazzCash">JazzCash</option>
                    <option value="EasyPaisa">EasyPaisa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>

                {Number(selectedInvoiceForPayment.paid_amount || 0) +
                  (Number(paymentAmountInput) || 0) >=
                  Number(selectedInvoiceForPayment.amount || 0) && (
                  <ResellerWalletGatePreview
                    resellerId={activeOwnerResellerId}
                    subscriberUsername={cleanUsername}
                    profileName={
                      selectedInvoiceForPayment.package_profile ||
                      selectedInvoiceForPayment.package_name ||
                      user?.original_package_profile ||
                      user?.package_profile_name ||
                      user?.package_speed ||
                      effectivePackage
                    }
                    actionLabel="renewal"
                    compact
                    onStatusChange={setPaymentWalletStatus}
                  />
                )}

                {paymentWalletError && (
                  <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{paymentWalletError}</span>
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-2 border-t border-slate-800 w-full min-w-0">
                  <button
                    type="button"
                    onClick={handleConfirmPayment}
                    disabled={
                      Number(paymentAmountInput) <= 0 ||
                      Boolean(
                        Number(selectedInvoiceForPayment.paid_amount || 0) +
                          (Number(paymentAmountInput) || 0) >=
                          Number(selectedInvoiceForPayment.amount || 0) &&
                          paymentWalletStatus?.blocked
                      )
                    }
                    className="w-full min-w-0 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-base transition shadow flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {Number(selectedInvoiceForPayment.paid_amount || 0) +
                      (Number(paymentAmountInput) || 0) >=
                      Number(selectedInvoiceForPayment.amount || 0) &&
                    paymentWalletStatus?.blocked ? (
                      <>
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Wallet Payment Gate Blocked</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Confirm &amp; Save Payment</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentWalletError(null);
                      setIsRecordPaymentModalOpen(false);
                    }}
                    className="w-full min-w-0 py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-base transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL 7: EDIT MATERIAL / HARDWARE LOG ENTRY (TAB 1) */}
      {materialToEdit &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 overflow-y-auto font-sans">
            <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto rounded-2xl box-border bg-[#111A2E] border border-indigo-700/70 p-4 sm:p-5 shadow-2xl relative">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Edit className="w-4 h-4 text-indigo-400" />
                  <span>Edit Material &amp; Hardware Log</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setMaterialToEdit(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUpdateMaterial} className="space-y-3.5 mt-4 text-xs">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Item Name</label>
                  <input
                    type="text"
                    required
                    value={editMaterialForm.itemName}
                    onChange={(e) => setEditMaterialForm({ ...editMaterialForm, itemName: e.target.value })}
                    placeholder="e.g. 2-Core FTTH Drop Wire Cable"
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Quantity (Meters / Units)</label>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={editMaterialForm.quantity}
                      onChange={(e) =>
                        setEditMaterialForm({ ...editMaterialForm, quantity: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Unit Cost ({currencySymbol})</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={editMaterialForm.unitCost}
                      onChange={(e) =>
                        setEditMaterialForm({ ...editMaterialForm, unitCost: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Installed By (Agent)</label>
                    <select
                      value={editMaterialForm.installedByAgent}
                      onChange={(e) =>
                        setEditMaterialForm({ ...editMaterialForm, installedByAgent: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="">-- Field Technician / NOC --</option>
                      {editMaterialForm.installedByAgent &&
                        !portalAgents.some((ag) => ag.full_name === editMaterialForm.installedByAgent) && (
                          <option value={editMaterialForm.installedByAgent}>
                            {editMaterialForm.installedByAgent}
                          </option>
                        )}
                      {portalAgents.map((ag) => (
                        <option key={ag.id} value={ag.full_name}>
                          {ag.full_name} {ag.area ? `(${ag.area})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Date</label>
                    <input
                      type="date"
                      required
                      value={editMaterialForm.date}
                      onChange={(e) => setEditMaterialForm({ ...editMaterialForm, date: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1.5">
                  <div className="flex justify-between items-center font-mono">
                    <span className="text-slate-400">Recalculated Total Charge:</span>
                    <span className="text-cyan-300 font-bold text-sm">
                      {formatCurrency(
                        (Number(editMaterialForm.quantity) || 0) * (Number(editMaterialForm.unitCost) || 0)
                      )}
                    </span>
                  </div>
                  {materialToEdit.added_to_invoice && (
                    <p className="text-[11px] text-emerald-300/90 flex items-center gap-1.5 pt-1 border-t border-slate-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>
                        Billed item: any linked unpaid <strong className="font-mono">INV-MAT-*</strong> invoice will auto-recalculate to match.
                      </span>
                    </p>
                  )}
                </div>

                {editMaterialError && (
                  <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{editMaterialError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setEditMaterialError(null);
                      setMaterialToEdit(null);
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdatingMaterial}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-lg transition shadow flex items-center gap-1.5 cursor-pointer"
                  >
                    {isUpdatingMaterial ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Material Changes</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL 8: DELETE MATERIAL CONFIRMATION (TAB 1) */}
      {materialToDelete &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 overflow-y-auto font-sans">
            <div className="w-[95vw] sm:w-full max-w-md mx-auto rounded-2xl box-border bg-[#111A2E] border border-rose-800/80 p-5 shadow-2xl space-y-4">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
                <div className="p-2.5 bg-rose-950 border border-rose-700 text-rose-400 rounded-xl shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white">Delete Material Entry?</h3>
                  <p className="text-xs text-rose-300 font-mono truncate">{materialToDelete.item_name}</p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Quantity × Unit Cost:</span>
                  <span className="text-white">
                    {materialToDelete.quantity} × {formatCurrency(materialToDelete.unit_cost)}
                  </span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-slate-400">Total Charge:</span>
                  <span className="text-rose-300">
                    {formatCurrency(Number(materialToDelete.quantity) * Number(materialToDelete.unit_cost))}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                This permanently removes the material row from <code className="text-cyan-300">subscriber_inventory_logs</code>.
                {materialToDelete.added_to_invoice && (
                  <>
                    {' '}
                    Because this item was billed, any linked unpaid <strong className="text-white font-mono">INV-MAT-*</strong> invoice will automatically recalculate (or be removed if no billed items remain and Rs. 0 is paid).
                  </>
                )}
              </p>

              {deleteMaterialError && (
                <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{deleteMaterialError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteMaterialError(null);
                    setMaterialToDelete(null);
                  }}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteMaterial}
                  disabled={isDeletingMaterial}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isDeletingMaterial ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <span>Delete Material</span>
                  )}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL 9: EDIT INVOICE MODAL (TAB 2) */}
      {invoiceToEdit &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 overflow-y-auto font-sans">
            <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto rounded-2xl box-border bg-[#111A2E] border border-indigo-700/70 p-4 sm:p-5 shadow-2xl relative">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Edit className="w-4 h-4 text-indigo-400" />
                    <span>Edit Invoice Details</span>
                  </h3>
                  <p className="text-[11px] font-mono text-cyan-400 mt-0.5">
                    #{invoiceToEdit.invoice_no} • @{cleanUsername}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditInvoiceError(null);
                    setInvoiceToEdit(null);
                  }}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleUpdateInvoice} className="space-y-3.5 mt-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Amount ({currencySymbol})</label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={editInvoiceForm.amount}
                      onChange={(e) =>
                        setEditInvoiceForm({ ...editInvoiceForm, amount: Number(e.target.value) })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Due Date</label>
                    <input
                      type="date"
                      required
                      value={editInvoiceForm.dueDate}
                      onChange={(e) =>
                        setEditInvoiceForm({ ...editInvoiceForm, dueDate: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Status</label>
                    <select
                      value={editInvoiceForm.status}
                      onChange={(e) =>
                        setEditInvoiceForm({
                          ...editInvoiceForm,
                          status: e.target.value as 'DUE' | 'PARTIAL' | 'PAID' | 'OVERDUE',
                        })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="DUE">DUE</option>
                      <option value="PARTIAL">PARTIAL</option>
                      <option value="PAID">PAID</option>
                      <option value="OVERDUE">OVERDUE</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-300 mb-1">Assigned Agent</label>
                    <select
                      value={editInvoiceForm.assignedAgentId}
                      onChange={(e) =>
                        setEditInvoiceForm({ ...editInvoiceForm, assignedAgentId: e.target.value })
                      }
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="">-- Unassigned --</option>
                      {portalAgents.map((ag) => (
                        <option key={ag.id} value={ag.id}>
                          {ag.full_name} {ag.area ? `(${ag.area})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-medium text-slate-300 mb-1">Notes</label>
                  <textarea
                    rows={2}
                    value={editInvoiceForm.notes}
                    onChange={(e) => setEditInvoiceForm({ ...editInvoiceForm, notes: e.target.value })}
                    placeholder="Optional billing adjustment note or remark..."
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {editInvoiceForm.status === 'PAID' &&
                  String(invoiceToEdit.status || '').toUpperCase() !== 'PAID' && (
                    <ResellerWalletGatePreview
                      resellerId={activeOwnerResellerId}
                      subscriberUsername={cleanUsername}
                      profileName={
                        invoiceToEdit.package_profile ||
                        invoiceToEdit.package_name ||
                        user?.original_package_profile ||
                        user?.package_profile_name ||
                        user?.package_speed ||
                        effectivePackage
                      }
                      actionLabel="renewal"
                      compact
                      onStatusChange={setEditInvoiceWalletStatus}
                    />
                  )}

                {editInvoiceError && (
                  <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span>{editInvoiceError}</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setEditInvoiceError(null);
                      setInvoiceToEdit(null);
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isUpdatingInvoice ||
                      Boolean(
                        editInvoiceForm.status === 'PAID' &&
                          String(invoiceToEdit.status || '').toUpperCase() !== 'PAID' &&
                          editInvoiceWalletStatus?.blocked
                      )
                    }
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold rounded-lg transition shadow flex items-center gap-1.5 cursor-pointer"
                  >
                    {isUpdatingInvoice ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <span>Save Invoice</span>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

      {/* MODAL 10: DELETE INVOICE CONFIRMATION (TAB 2) */}
      {invoiceToDelete &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          (() => {
            const linkedTxs = transactions.filter((t) => t.invoice_id === invoiceToDelete.id);
            return (
              <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 overflow-y-auto font-sans">
                <div className="w-[95vw] sm:w-full max-w-md mx-auto rounded-2xl box-border bg-[#111A2E] border border-rose-800/80 p-5 shadow-2xl space-y-4">
                  <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
                    <div className="p-2.5 bg-rose-950 border border-rose-700 text-rose-400 rounded-xl shrink-0">
                      <Trash2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-white">
                        Delete Invoice {invoiceToDelete.invoice_no}?
                      </h3>
                      <p className="text-xs text-rose-300 font-mono truncate">@{cleanUsername}</p>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Invoice Amount:</span>
                      <span className="text-white font-bold">{formatCurrency(invoiceToDelete.amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Paid Recorded:</span>
                      <span className="text-emerald-400">
                        {formatCurrency(invoiceToDelete.paid_amount || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Linked Receipts:</span>
                      <span className="text-amber-300">{linkedTxs.length} payment transaction(s)</span>
                    </div>
                  </div>

                  {linkedTxs.length > 0 && (
                    <label className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-950/30 border border-rose-800/60 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={deleteLinkedPayments}
                        onChange={(e) => setDeleteLinkedPayments(e.target.checked)}
                        className="mt-0.5 w-4 h-4 rounded bg-slate-900 border-slate-700 text-rose-600 cursor-pointer"
                      />
                      <span className="text-rose-200 leading-relaxed">
                        Also delete <strong>{linkedTxs.length}</strong> linked receipt(s) from{' '}
                        <code className="text-cyan-300">payment_transactions</code> so the subscriber&apos;s balance and receipt ledger stay in sync.
                      </span>
                    </label>
                  )}

                  <p className="text-xs text-slate-400">
                    This action permanently deletes the invoice and immediately updates the subscriber&apos;s KPI totals and outstanding balance.
                  </p>

                  {deleteInvoiceError && (
                    <div className="rounded-xl border border-rose-500/70 bg-rose-950/90 px-3 py-2.5 text-xs font-semibold text-rose-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{deleteInvoiceError}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteInvoiceError(null);
                        setInvoiceToDelete(null);
                      }}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteInvoice}
                      disabled={isDeletingInvoice}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-lg text-xs transition flex items-center gap-1.5 cursor-pointer"
                    >
                      {isDeletingInvoice ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Deleting...</span>
                        </>
                      ) : (
                        <span>Delete Invoice</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })(),
          document.body
        )}

      {/* Modal: Generate Invoice for Current Locked Subscriber */}
      <CreateInvoiceModal
        isOpen={isGenerateInvoiceModalOpen}
        onClose={() => setIsGenerateInvoiceModalOpen(false)}
        defaultCustomerId={cleanUsername}
        defaultSubscriberUsername={cleanUsername}
        onSuccess={() => {
          showToast('Invoice created successfully');
          fetchAllProfileData();
        }}
      />
    </div>
  );
};

export default SubscriberProfileView;
