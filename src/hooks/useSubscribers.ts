import { useMemo, useCallback } from 'react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import {
  Customer,
  Invoice,
  BillingSubscriber,
  BillingLedgerEntry,
  MikrotikPppSecret,
} from '../types/isp';
import { UserAccount } from '../types/auth';
import {
  createSecret,
  createScheduler,
  getProvisionedSecrets,
  getActiveSessions,
} from '../services/apiClient';
import {
  provisionPppoeSecretRest,
  createMikrotikSchedulerRest,
  fetchMikrotikPppSecrets,
  fetchMikrotikLiveTelemetry,
  safeMikrotikFetch,
} from '../services/mikrotikRestClient';
import {
  parseMikrotikComment,
  formatRouterOSSchedule,
  calculateRemainingTime,
} from '../services/mikrotikSubscriberSync';
import { safeResponseJson } from '../lib/safeFetch';

export const STORAGE_KEY_PORTAL_USERS = 'youthnet_portal_users';
export const STORAGE_KEY_BILLING_SUBSCRIBERS = 'youthnet_billing_subscribers';
export const STORAGE_KEY_BILLING_LEDGER = 'youthnet_billing_ledger';

export interface UnifiedSubscriber {
  id: string;
  username: string;
  pppoeUsername: string;
  name: string;
  fullName: string;
  phone: string;
  address: string;
  areaNode: string;
  ponPort: string;
  feederLine: string;
  cnic: string;
  profile: string;
  packageId?: string;
  priceMonthly: number;
  assignedIp: string;
  macAddress: string;
  service: string;
  status: 'active' | 'walled_garden' | 'disabled' | 'expired';
  isOnline: boolean;
  createdDate: string;
  expiryDate: string;
  validityDays: number;
  validityLabel?: string;
  isExpired?: boolean;
  remainingText?: string;
  balanceDue: number;
  hasPortalAccount: boolean;
  portalUser?: any;
  invoices: Invoice[];
  accountNumber: string;
}

export interface ProvisionSubscriberParams {
  username: string;
  password: string;
  fullName?: string;
  phone?: string;
  address?: string;
  areaNode?: string;
  ponPort?: string;
  feederLine?: string;
  cnic?: string;
  profile?: string;
  service?: string;
  remoteIp?: string;
  creationDate?: string;
  validityDays?: number;
  validityPreset?: '2_hours' | '1_day' | '3_days' | '7_days' | '1_month' | 'custom';
  validityLabel?: string;
  targetExpiryDate?: Date | string;
  expiryDate?: string;
  expiredPool?: string;
  routerId?: string;
  initialBalance?: number;
  sendWhatsApp?: boolean;
}

// LocalStorage helpers with safe fallbacks
export function getStoredPortalUsers(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PORTAL_USERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredPortalUsers(users: any[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_PORTAL_USERS, JSON.stringify(users));
  } catch {}
}

export function getStoredBillingSubscribers(): BillingSubscriber[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BILLING_SUBSCRIBERS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStoredBillingSubscribers(subs: BillingSubscriber[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_BILLING_SUBSCRIBERS, JSON.stringify(subs));
  } catch {}
}

export function getStoredBillingLedger(): BillingLedgerEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_BILLING_LEDGER);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function appendStoredBillingLedger(entry: BillingLedgerEntry) {
  if (typeof window === 'undefined') return;
  try {
    const current = getStoredBillingLedger();
    localStorage.setItem(STORAGE_KEY_BILLING_LEDGER, JSON.stringify([entry, ...current]));
  } catch {}
}

export const useSubscribers = () => {
  const {
    customers,
    setCustomers,
    provisionedSecrets,
    setProvisionedSecrets,
    activeSessions,
    setActiveSessions,
    invoices,
    setInvoices,
    packages,
    routers,
    selectedRouterId,
    complaints,
    logWhatsAppNotice,
    syncSelectedRouterNow,
  } = useISP();
  const { formatCurrency } = useCurrency();

  // Unified subscriber list merging MikroTik secrets, registered customers, portal users, and billing data
  const unifiedSubscribers: UnifiedSubscriber[] = useMemo(() => {
    const portalUsers = getStoredPortalUsers();
    const billingSubs = getStoredBillingSubscribers();
    const subMap = new Map<string, UnifiedSubscriber>();

    // 1. Ingest registered customers from state / DB
    customers.forEach((c) => {
      const uKey = (c.pppoeUsername || c.name || c.id).toLowerCase();
      const matchedPkg = packages.find((p) => p.id === c.packageId || p.mikrotikProfile === c.packageId);
      const isOnline = activeSessions.some((s) => s.username?.toLowerCase() === uKey);
      const userInvoices = invoices.filter((i) => i.customerId === c.id || (i.customerName && i.customerName.toLowerCase() === c.name.toLowerCase()));
      const portalRec = portalUsers.find((p) => (p.username || '').toLowerCase() === uKey);

      subMap.set(uKey, {
        id: c.id,
        username: c.pppoeUsername || uKey,
        pppoeUsername: c.pppoeUsername || uKey,
        name: c.name || uKey,
        fullName: c.name || uKey,
        phone: c.phone || '',
        address: c.address || '',
        areaNode: c.areaNode || 'Sector G-11 (North Zone)',
        ponPort: (c as any).ponPort || 'PON-01',
        feederLine: (c as any).feederLine || 'Feeder-North-01',
        cnic: (c as any).cnic || '',
        profile: matchedPkg?.mikrotikProfile || 'default',
        packageId: matchedPkg?.id,
        priceMonthly: matchedPkg?.priceMonthly || 2500,
        assignedIp: c.assignedIp || (isOnline ? activeSessions.find((s) => s.username?.toLowerCase() === uKey)?.address || 'Dynamic' : 'Dynamic'),
        macAddress: c.macAddress || '',
        service: 'pppoe',
        status: (c.status as any) || 'active',
        isOnline,
        createdDate: c.createdDate || c.installationDate || '2026-10-30',
        expiryDate: c.expiryDate || '2026-11-29',
        validityDays: c.validityDays || 30,
        balanceDue: c.balanceDue || 0,
        hasPortalAccount: Boolean(portalRec),
        portalUser: portalRec,
        invoices: userInvoices,
        accountNumber: c.accountNumber || `NP-${uKey.toUpperCase().slice(0, 6)}`,
      });
    });

    // 2. Ingest live MikroTik provisioned secrets (/api/mikrotik/ppp/secret)
    (provisionedSecrets || []).forEach((sec) => {
      const uKey = (sec.name || '').toLowerCase();
      if (!uKey) return;

      const parsed = parseMikrotikComment(sec.comment, sec.name);
      const isOnline = activeSessions.some((s) => s.username?.toLowerCase() === uKey);
      const liveSession = activeSessions.find((s) => s.username?.toLowerCase() === uKey);
      const portalRec = portalUsers.find((p) => (p.username || '').toLowerCase() === uKey);
      const billingRec = billingSubs.find((b) => (b.username || '').toLowerCase() === uKey);
      const matchedPkg = packages.find((p) => p.mikrotikProfile === sec.profile || p.name === sec.profile);

      const existing = subMap.get(uKey);
      if (existing) {
        // Merge fresh MikroTik data
        existing.profile = sec.profile || existing.profile;
        if (sec['remote-address']) existing.assignedIp = sec['remote-address'];
        if (liveSession?.address) existing.assignedIp = liveSession.address;
        if (liveSession?.callerId) existing.macAddress = liveSession.callerId;
        existing.isOnline = isOnline;
        const effectiveExpiry = parsed.expiryDate || existing.expiryDate;
        const expCheck = calculateRemainingTime(effectiveExpiry);
        if (expCheck.isExpired || sec.profile?.toLowerCase().includes('expired')) {
          existing.status = 'expired';
          existing.isExpired = true;
          existing.remainingText = 'EXPIRED / RESTRICTED';
        } else {
          existing.isExpired = false;
          existing.remainingText = expCheck.remainingText;
        }
        if (parsed.validityLabel) existing.validityLabel = parsed.validityLabel;
        if (parsed.createdDate) existing.createdDate = parsed.createdDate;
        if (parsed.expiryDate) existing.expiryDate = parsed.expiryDate;
        if (parsed.phone && !existing.phone) existing.phone = parsed.phone;
        if (parsed.name && existing.name === existing.username) existing.name = parsed.name;
        if (parsed.address && !existing.address) existing.address = parsed.address;
        if (billingRec?.packagePriceMonthly) existing.priceMonthly = billingRec.packagePriceMonthly;
      } else {
        // Create new unified entry from router secret
        const phone = parsed.phone || billingRec?.phone || portalRec?.phone || '';
        const name = parsed.name || billingRec?.fullName || portalRec?.fullName || sec.name;
        const address = parsed.address || billingRec?.address || 'Sector G-11 Core';
        const areaNode = billingRec?.areaNode || 'Sector G-11 (North Zone)';
        const ponPort = billingRec?.ponPort || 'PON-01';
        const feederLine = billingRec?.feederLine || 'Feeder-North-01';
        const priceMonthly = billingRec?.packagePriceMonthly || matchedPkg?.priceMonthly || 2500;
        const userInvoices = invoices.filter((i) => (i.customerName && i.customerName.toLowerCase() === name.toLowerCase()) || i.invoiceNumber.toLowerCase().includes(uKey));

        const effectiveExpiry = parsed.expiryDate || '2026-11-29';
        const expCheck = calculateRemainingTime(effectiveExpiry);
        const computedStatus: 'active' | 'walled_garden' | 'disabled' | 'expired' =
          (sec.disabled === true || sec.disabled === 'true')
            ? 'disabled'
            : expCheck.isExpired || sec.profile?.toLowerCase().includes('expired')
            ? 'expired'
            : 'active';

        subMap.set(uKey, {
          id: sec['.id'] || `sec-${uKey}`,
          username: sec.name,
          pppoeUsername: sec.name,
          name,
          fullName: name,
          phone,
          address,
          areaNode,
          ponPort,
          feederLine,
          cnic: '',
          profile: sec.profile || 'default',
          packageId: matchedPkg?.id,
          priceMonthly,
          assignedIp: sec['remote-address'] || liveSession?.address || 'Dynamic',
          macAddress: liveSession?.callerId || '',
          service: sec.service || 'pppoe',
          status: computedStatus,
          isOnline,
          createdDate: parsed.createdDate || '2026-10-30',
          expiryDate: parsed.expiryDate || '2026-11-29',
          validityDays: parsed.validityDays || 30,
          validityLabel: parsed.validityLabel,
          isExpired: expCheck.isExpired,
          remainingText: expCheck.remainingText,
          balanceDue: billingRec?.balanceDue || 0,
          hasPortalAccount: Boolean(portalRec),
          portalUser: portalRec,
          invoices: userInvoices,
          accountNumber: `NP-${uKey.toUpperCase().slice(0, 6)}`,
        });
      }
    });

    // 3. Ingest portal users (youthnet_portal_users) not yet in subMap
    portalUsers.forEach((pu) => {
      const uKey = (pu.username || '').toLowerCase();
      if (!uKey || subMap.has(uKey)) return;

      const isOnline = activeSessions.some((s) => s.username?.toLowerCase() === uKey);
      const userInvoices = invoices.filter((i) => (i.customerName && i.customerName.toLowerCase() === (pu.fullName || '').toLowerCase()) || i.invoiceNumber.toLowerCase().includes(uKey));
      const matchedPkg = packages.find((p) => p.mikrotikProfile === pu.profile || p.name === pu.profile);

      subMap.set(uKey, {
        id: pu.id || `usr-${uKey}`,
        username: pu.username,
        pppoeUsername: pu.username,
        name: pu.fullName || pu.username,
        fullName: pu.fullName || pu.username,
        phone: pu.phone || '',
        address: 'Sector G-11 Area',
        areaNode: 'Sector G-11 (North Zone)',
        ponPort: 'PON-01',
        feederLine: 'Feeder-North-01',
        cnic: '',
        profile: pu.profile || 'default',
        packageId: matchedPkg?.id,
        priceMonthly: matchedPkg?.priceMonthly || 2500,
        assignedIp: pu.assignedIp || (isOnline ? activeSessions.find((s) => s.username?.toLowerCase() === uKey)?.address || 'Dynamic' : 'Dynamic'),
        macAddress: pu.callerId || '',
        service: 'pppoe',
        status: 'active',
        isOnline,
        createdDate: pu.createdAt?.split('T')[0] || '2026-10-30',
        expiryDate: '2026-11-29',
        validityDays: 30,
        balanceDue: 0,
        hasPortalAccount: true,
        portalUser: pu,
        invoices: userInvoices,
        accountNumber: `NP-${uKey.toUpperCase().slice(0, 6)}`,
      });
    });

    return Array.from(subMap.values());
  }, [customers, provisionedSecrets, activeSessions, invoices, packages]);

  // Master End-to-End User Provisioning Method
  const provisionSubscriber = useCallback(
    async (params: ProvisionSubscriberParams): Promise<{
      success: boolean;
      user: any;
      invoice: Invoice;
      portalUser: any;
      schedulerRegistered?: boolean;
      schedulerWarning?: string | null;
      targetExpiryDate?: string;
      scheduleTimes?: {
        startDate: string;
        startTime: string;
        isoString: string;
        readable: string;
      };
      message: string;
    }> => {
      const cleanUsername = params.username.trim().toLowerCase();
      const plainPassword = params.password.trim();
      const fullName = (params.fullName || cleanUsername).trim();
      const phone = (params.phone || '+92 300 0000000').trim();
      const address = (params.address || 'Central Distribution Area, Sector G-11').trim();
      const areaNode = params.areaNode || 'Sector G-11 (North Zone)';
      const ponPort = params.ponPort || 'PON-01';
      const feederLine = params.feederLine || 'Feeder-North-01';
      const cnic = params.cnic?.trim() || '';
      const profile = params.profile || 'default';
      const service = params.service || 'pppoe';
      const targetRouterId = params.routerId || selectedRouterId;
      const today = params.creationDate || new Date().toISOString().split('T')[0];
      const validityDays = Number(params.validityDays) || 30;

      // Compute target expiry Date object based on preset, custom datetime, or days
      let targetExpiryDateObj: Date;
      if (params.targetExpiryDate) {
        targetExpiryDateObj = typeof params.targetExpiryDate === 'string'
          ? new Date(params.targetExpiryDate)
          : params.targetExpiryDate;
      } else if (params.validityPreset === '2_hours') {
        targetExpiryDateObj = new Date(Date.now() + 2 * 60 * 60 * 1000);
      } else if (params.validityPreset === '1_day') {
        targetExpiryDateObj = new Date(Date.now() + 24 * 60 * 60 * 1000);
      } else if (params.validityPreset === '3_days') {
        targetExpiryDateObj = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      } else if (params.validityPreset === '7_days') {
        targetExpiryDateObj = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      } else if (params.validityPreset === '1_month') {
        targetExpiryDateObj = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      } else if (params.expiryDate) {
        targetExpiryDateObj = new Date(params.expiryDate);
      } else {
        const days = Number(params.validityDays) || 30;
        targetExpiryDateObj = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }

      if (isNaN(targetExpiryDateObj.getTime())) {
        targetExpiryDateObj = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }

      const scheduleTimes = formatRouterOSSchedule(targetExpiryDateObj);
      const targetExpiryIso = targetExpiryDateObj.toISOString();
      const expiryDate = targetExpiryIso.split('T')[0];
      const selectedValidityLabel =
        params.validityLabel ||
        (params.validityPreset === '2_hours'
          ? '2 Hours'
          : params.validityPreset === '1_day'
          ? '1 Day'
          : params.validityPreset === '3_days'
          ? '3 Days'
          : params.validityPreset === '7_days'
          ? '7 Days'
          : `${validityDays} Days`);

      const matchedPackage =
        packages.find((p) => p.mikrotikProfile === profile || p.name === profile) ||
        packages[0];
      const packagePrice = matchedPackage ? matchedPackage.priceMonthly : 2500;
      const targetRouter =
        routers.find((r) => r.id === targetRouterId) || routers[0];

      // Step A: Structured Comment JSON with ISO timestamps and validity label
      const commentJson = JSON.stringify({
        created: new Date().toISOString(),
        expires: targetExpiryIso,
        validityLabel: selectedValidityLabel,
        phone: phone || '',
        address: address || '',
        cnic,
        ponPort,
        feederLine,
        name: fullName,
        plan: profile,
        days: validityDays,
        expiredPool: params.expiredPool || '16.16.16.0/24',
      });

      // 1. Dispatch POST /api/mikrotik/ppp/secret/add directly to RouterOS REST API
      let restProvisioned = false;
      if (targetRouter) {
        try {
          const restResult = await createSecret({
            name: cleanUsername,
            password: plainPassword,
            service,
            profile,
            comment: commentJson,
          }, targetRouter);
          if (restResult.success) {
            restProvisioned = true;
          }
        } catch (restErr) {
          console.warn('Physical REST secret provision notice:', restErr);
        }
      }

      // Step B: Create Native MikroTik Scheduler Entry for Router-Level Auto-Expiration
      let schedulerRegistered = false;
      let schedulerWarning: string | null = null;
      if (targetRouter) {
        const eventScript = `/ppp secret set [find name="${cleanUsername}"] profile="expired_profile"; /ppp active remove [find name="${cleanUsername}"]; /system scheduler remove [find name="exp-${cleanUsername}"]`;
        try {
          const schedResult = await createScheduler({
            name: `exp-${cleanUsername}`,
            startDate: scheduleTimes.startDate,
            startTime: scheduleTimes.startTime,
            interval: '0s',
            onEvent: eventScript,
            comment: `Auto-expiry for ${cleanUsername}`,
          }, targetRouter);
          if (schedResult.success) {
            schedulerRegistered = true;
          } else {
            schedulerWarning = 'User created, but on-router schedule failed to register';
            console.warn('RouterOS scheduler registration warning:', schedResult.error);
          }
        } catch (schedErr: any) {
          schedulerWarning = 'User created, but on-router schedule failed to register';
          console.warn('RouterOS scheduler exception:', schedErr);
        }
      }

      // Refresh /api/mikrotik/ppp/secret immediately so user displays in tables
      if (targetRouter) {
        getProvisionedSecrets(targetRouter)
          .then((secRes) => {
            if (secRes.success && Array.isArray(secRes.secrets)) {
              setProvisionedSecrets(secRes.secrets);
            }
          })
          .catch(() => {});
      }

      // Also persist to backend DB endpoint (/api/mikrotik/users)
      try {
        await safeMikrotikFetch('/api/mikrotik/users', {
          method: 'POST',
          body: JSON.stringify({
            routerId: targetRouterId,
            username: cleanUsername,
            password: plainPassword,
            service,
            profile,
            remoteAddress: params.remoteIp || undefined,
            comment: commentJson,
            createdDate: today,
            expiryDate,
            validityDays,
            name: fullName,
            phone,
            address,
            areaNode,
            packageId: matchedPackage?.id,
          }),
        }).catch(() => {});
      } catch {}

      // 2. Concurrently auto-create account in portal user repository (youthnet_portal_users & /api/auth/users)
      const portalUserRecord = {
        id: `usr-${cleanUsername}-${Date.now().toString().slice(-4)}`,
        username: cleanUsername,
        password: plainPassword,
        fullName,
        phone,
        role: 'CLIENT',
        linkedCustomerId: cleanUsername,
        pppoeUsername: cleanUsername,
        assignedIp: params.remoteIp || 'Dynamic',
        profile,
        createdAt: new Date().toISOString(),
      };

      try {
        const existingPortalUsers = getStoredPortalUsers();
        const updatedPortalUsers = [
          portalUserRecord,
          ...existingPortalUsers.filter((u) => u.username?.toLowerCase() !== cleanUsername),
        ];
        saveStoredPortalUsers(updatedPortalUsers);
      } catch (err) {
        console.warn('Portal user save warning:', err);
      }

      try {
        await fetch('/api/auth/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: cleanUsername,
            fullName,
            phone,
            role: 'CLIENT',
            password: plainPassword,
            isActive: true,
          }),
        }).catch(() => {});
      } catch {}

      // 3. Register subscriber automatically into active recurring billing cycle (youthnet_billing_subscribers)
      const now = new Date();
      const billingDay = 1;
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const nextBillingDate = nextMonth.toISOString().split('T')[0];

      const billingSubscriberRecord: BillingSubscriber = {
        id: `bill-sub-${cleanUsername}`,
        username: cleanUsername,
        fullName,
        phone,
        address,
        areaNode,
        ponPort,
        feederLine,
        cnic,
        profile,
        packagePriceMonthly: packagePrice,
        billingDay,
        nextBillingDate,
        status: 'active',
        lastInvoiceNumber: '',
        balanceDue: packagePrice,
        createdAt: new Date().toISOString(),
      };

      try {
        const existingBillingSubs = getStoredBillingSubscribers();
        const updatedBillingSubs = [
          billingSubscriberRecord,
          ...existingBillingSubs.filter((b) => b.username?.toLowerCase() !== cleanUsername),
        ];
        saveStoredBillingSubscribers(updatedBillingSubs);
      } catch (err) {
        console.warn('Billing subscriber save warning:', err);
      }

      // 4. Generate first initial invoice automatically (INV-[MONTH]-[USERNAME])
      const monthStr = now.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      const yearStr = now.getFullYear();
      const initialInvoiceNumber = `INV-${monthStr}${yearStr}-${cleanUsername.toUpperCase()}`;
      const dueDate = new Date(now.getFullYear(), now.getMonth(), 10).toISOString().split('T')[0];

      const initialInvoice: Invoice = {
        id: `inv-${Date.now()}-${cleanUsername}`,
        invoiceNumber: initialInvoiceNumber,
        customerId: `cust-${cleanUsername}`,
        customerName: fullName,
        customerPhone: phone,
        packageId: matchedPackage?.id || profile,
        packageName: matchedPackage?.name || profile,
        billingMonth: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
        baseAmount: packagePrice,
        taxAmount: Math.round(packagePrice * 0.16),
        discountAmount: 0,
        totalAmount: Math.round(packagePrice * 1.16),
        status: 'unpaid',
        dueDate,
        issuedAt: now.toISOString(),
        whatsappNoticeSent: true,
        whatsappNoticeTimestamp: now.toISOString(),
      };

      // Persist invoice into state & localStorage
      setInvoices((prev) => {
        const updated = [
          initialInvoice,
          ...prev.filter((i) => i.invoiceNumber !== initialInvoiceNumber),
        ];
        try {
          localStorage.setItem('registered_invoices', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      // Update lastInvoiceNumber in billing subscribers
      billingSubscriberRecord.lastInvoiceNumber = initialInvoiceNumber;
      billingSubscriberRecord.balanceDue = initialInvoice.totalAmount;

      // 5. Append to Ledger History (youthnet_billing_ledger)
      const ledgerEntry: BillingLedgerEntry = {
        id: `led-${Date.now()}-${cleanUsername}`,
        date: today,
        subscriberUsername: cleanUsername,
        subscriberName: fullName,
        type: 'invoice_issued',
        referenceNumber: initialInvoiceNumber,
        description: `Initial Connection & Monthly Broadband Package Invoice (${matchedPackage?.name || profile})`,
        debit: initialInvoice.totalAmount,
        credit: 0,
        balanceAfter: initialInvoice.totalAmount,
        recordedBy: 'Automated Provisioning Engine',
      };
      appendStoredBillingLedger(ledgerEntry);

      // 6. Update Customer Record in State & LocalStorage
      const newCustomerRecord: Customer = {
        id: `cust-${cleanUsername}`,
        accountNumber: `NP-${cleanUsername.toUpperCase().slice(0, 6)}`,
        name: fullName,
        phone,
        email: `${cleanUsername}@youthnet.pk`,
        address,
        areaNode,
        connectionType: 'pppoe',
        pppoeUsername: cleanUsername,
        assignedIp: params.remoteIp || `10.50.${Math.floor(Math.random() * 40 + 10)}.${Math.floor(Math.random() * 240 + 10)}`,
        macAddress: `44:D9:E7:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}:${Math.floor(10 + Math.random() * 89)}`,
        packageId: matchedPackage?.id || profile,
        routerId: targetRouterId || routers[0]?.id || '',
        status: 'active',
        installationDate: today,
        billingDay: 1,
        balanceDue: initialInvoice.totalAmount,
        ontSignalDbm: -18.8,
        createdDate: today,
        expiryDate,
        validityDays,
      };

      setCustomers((prev) => {
        const updated = [
          newCustomerRecord,
          ...prev.filter((c) => c.pppoeUsername?.toLowerCase() !== cleanUsername),
        ];
        try {
          localStorage.setItem('registered_customers', JSON.stringify(updated));
        } catch {}
        return updated;
      });

      // 7. Update provisionedSecrets directly in state for immediate table rendering
      const newSecretRecord: MikrotikPppSecret = {
        '.id': `*new_${cleanUsername}`,
        name: cleanUsername,
        password: plainPassword,
        profile,
        service,
        comment: commentJson,
        'remote-address': params.remoteIp || 'Dynamic',
        disabled: false,
      };

      setProvisionedSecrets((prev) => [
        newSecretRecord,
        ...(prev || []).filter((s) => s.name?.toLowerCase() !== cleanUsername),
      ]);

      // Re-fetch RouterOS secrets in background immediately
      if (targetRouter) {
        Promise.all([
          fetchMikrotikPppSecrets(targetRouter),
          fetchMikrotikLiveTelemetry(targetRouter, { pollSessions: true, pollTraffic: false }),
        ])
          .then(([secRes, telRes]) => {
            if (secRes.success && Array.isArray(secRes.secrets) && secRes.secrets.length > 0) {
              setProvisionedSecrets(secRes.secrets);
            }
            if (telRes.success && Array.isArray(telRes.activeSessions)) {
              setActiveSessions(telRes.activeSessions);
            }
          })
          .catch(() => {});
      }

      // 8. Log Welcome WhatsApp notice
      if (logWhatsAppNotice) {
        const welcomeText =
          `🎉 *WELCOME TO YOUTH NET BROADBAND*\n\n` +
          `Dear *${fullName}*,\n` +
          `Your PPPoE fiber broadband service has been activated!\n\n` +
          `👤 *PPPoE Login:* ${cleanUsername}\n` +
          `🔑 *Password:* ${plainPassword}\n` +
          `📦 *Package:* ${matchedPackage?.name || profile}\n` +
          `📄 *First Invoice #:* ${initialInvoiceNumber}\n` +
          `💰 *Amount Due:* ${formatCurrency(initialInvoice.totalAmount)}\n` +
          `📅 *Due Date:* ${dueDate}\n\n` +
          `Client Portal: https://youthnet.pk/portal\n` +
          `Thank you for trusting Youth Net Service!`;

        logWhatsAppNotice(
          phone,
          fullName,
          welcomeText,
          'youth_net_welcome_provision'
        );
      }

      return {
        success: true,
        user: newCustomerRecord,
        invoice: initialInvoice,
        portalUser: portalUserRecord,
        schedulerRegistered,
        schedulerWarning,
        targetExpiryDate: targetExpiryIso,
        scheduleTimes,
        message: schedulerWarning
          ? `Subscriber ${cleanUsername} provisioned on MikroTik, portal account created, initial invoice ${initialInvoiceNumber} issued. (${schedulerWarning})`
          : `Subscriber ${cleanUsername} provisioned on MikroTik, portal account created, initial invoice ${initialInvoiceNumber} issued, and auto-expiry scheduled for ${scheduleTimes.readable}.`,
      };
    },
    [
      routers,
      selectedRouterId,
      packages,
      setInvoices,
      setCustomers,
      setProvisionedSecrets,
      setActiveSessions,
      logWhatsAppNotice,
      formatCurrency,
    ]
  );

  return {
    unifiedSubscribers,
    provisionSubscriber,
    getStoredBillingSubscribers,
    getStoredPortalUsers,
    getStoredBillingLedger,
  };
};
