import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package,
  Plus,
  Search,
  RefreshCw,
  Edit3,
  Trash2,
  X,
  AlertTriangle,
  CheckCircle2,
  Database,
  Copy,
  ShoppingCart,
  Truck,
  Building2,
  TrendingUp,
  DollarSign,
  Receipt,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Phone,
} from 'lucide-react';
import {
  supabase,
  SupabaseInventoryItem,
  SupabaseInventoryPurchase,
  SupabaseInventorySale,
  SupabaseVendor,
  SupabaseVendorTransaction,
  SupabasePortalUser,
  IspExpensePaymentMethod,
  InventoryPurchasePaymentStatus,
  InventorySalePaymentStatus,
} from '../services/supabaseClient';
import {
  INVENTORY_CATEGORIES,
  getInventoryCategoryMeta,
  fetchInventoryItems,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  fetchVendors,
  createVendor,
  updateVendor,
  deleteVendor,
  fetchVendorTransactions,
  recordVendorPayment,
  fetchInventoryPurchases,
  createInventoryPurchase,
  deleteInventoryPurchase,
  fetchInventorySales,
  createInventorySale,
  updateInventorySale,
  deleteInventorySale,
} from '../services/erpInventoryService';
import { ERP_MIGRATION_SQL } from '../lib/erpMigrationSql';
import { useCurrency } from '../context/CurrencyContext';
import { useAuth } from '../context/AuthContext';
import { DateFilterToolbar } from './DateFilterToolbar';
import {
  DateFilterState,
  createDefaultDateFilter,
  describeDateFilter,
  getTodayDateInputValue,
  matchesDateFilter,
} from '../lib/dateFilter';

type InventorySubTab = 'catalog' | 'sales' | 'purchases' | 'vendors';

export const InventoryHardwareView: React.FC = () => {
  const { formatCurrency } = useCurrency();
  const { currentUser } = useAuth();

  const [activeSubTab, setActiveSubTab] = useState<InventorySubTab>('catalog');
  const [dateFilter, setDateFilter] = useState<DateFilterState>(() =>
    createDefaultDateFilter('month')
  );

  // Supabase data
  const [items, setItems] = useState<SupabaseInventoryItem[]>([]);
  const [vendors, setVendors] = useState<SupabaseVendor[]>([]);
  const [purchases, setPurchases] = useState<SupabaseInventoryPurchase[]>([]);
  const [sales, setSales] = useState<SupabaseInventorySale[]>([]);
  const [agents, setAgents] = useState<SupabasePortalUser[]>([]);
  const [subscribers, setSubscribers] = useState<SupabasePortalUser[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [missingTable, setMissingTable] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Search & filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [saleStatusFilter, setSaleStatusFilter] = useState<string>('ALL');
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<string>('ALL');

  // SQL Setup Modal
  const [isSqlModalOpen, setIsSqlModalOpen] = useState<boolean>(false);
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Item Modal
  const [isItemModalOpen, setIsItemModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<SupabaseInventoryItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<SupabaseInventoryItem | null>(null);
  const [itemForm, setItemForm] = useState({
    item_name: '',
    category: 'ROUTER_ONT',
    unit: 'pcs',
    avg_purchase_cost: '',
    default_sale_price: '',
    stock_qty: '0',
    low_stock_alert: '5',
  });

  // Sale Modal
  const [isSaleModalOpen, setIsSaleModalOpen] = useState<boolean>(false);
  const [editingSale, setEditingSale] = useState<SupabaseInventorySale | null>(null);
  const [deletingSale, setDeletingSale] = useState<SupabaseInventorySale | null>(null);
  const [saleForm, setSaleForm] = useState({
    item_id: '',
    subscriber_username: '',
    customer_name: '',
    sold_by_agent: '',
    qty: '1',
    unit_sale_price: '',
    payment_status: 'PAID' as InventorySalePaymentStatus,
    sale_date: getTodayDateInputValue(),
    notes: '',
  });

  // Purchase Modal
  const [isPurchaseModalOpen, setIsPurchaseModalOpen] = useState<boolean>(false);
  const [deletingPurchase, setDeletingPurchase] = useState<SupabaseInventoryPurchase | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({
    item_id: '',
    vendor_id: '',
    qty: '1',
    unit_cost: '',
    payment_status: 'PAID' as InventoryPurchasePaymentStatus,
    amount_paid: '',
    purchase_date: getTodayDateInputValue(),
    notes: '',
  });

  // Vendor Modals
  const [isVendorModalOpen, setIsVendorModalOpen] = useState<boolean>(false);
  const [editingVendor, setEditingVendor] = useState<SupabaseVendor | null>(null);
  const [deletingVendor, setDeletingVendor] = useState<SupabaseVendor | null>(null);
  const [vendorForm, setVendorForm] = useState({
    vendor_name: '',
    company_name: '',
    phone: '',
  });

  // Vendor Payment Modal
  const [payingVendor, setPayingVendor] = useState<SupabaseVendor | null>(null);
  const [vendorPayForm, setVendorPayForm] = useState({
    amount: '',
    payment_method: 'CASH' as IspExpensePaymentMethod,
    reference_note: '',
    tx_date: getTodayDateInputValue(),
    postToExpenseLedger: true,
  });

  // Vendor History / Ledger Drawer Modal
  const [ledgerVendor, setLedgerVendor] = useState<SupabaseVendor | null>(null);
  const [vendorLedgerTxs, setVendorLedgerTxs] = useState<SupabaseVendorTransaction[]>([]);
  const [isLoadingVendorLedger, setIsLoadingVendorLedger] = useState<boolean>(false);

  const [isSaving, setIsSaving] = useState<boolean>(false);

  const showToast = useCallback((type: 'success' | 'error', text: string) => {
    setToastMessage({ type, text });
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4500);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const loadAllInventoryData = useCallback(async (quiet = false) => {
    if (!quiet) setIsRefreshing(true);
    setLoadError(null);
    try {
      const [itemsRes, vendorsRes, purchasesData, salesData, usersRes] = await Promise.all([
        fetchInventoryItems(),
        fetchVendors(),
        fetchInventoryPurchases(),
        fetchInventorySales(),
        supabase
          .from('portal_users')
          .select('id,username,full_name,role,phone,area')
          .in('role', ['AGENT', 'CLIENT'])
          .order('full_name', { ascending: true }),
      ]);

      setItems(itemsRes.data);
      setVendors(vendorsRes.data);
      setPurchases(purchasesData);
      setSales(salesData);
      setMissingTable(itemsRes.missingTable || vendorsRes.missingTable);
      if (itemsRes.error && !itemsRes.missingTable) {
        setLoadError(itemsRes.error);
      }

      if (Array.isArray(usersRes.data)) {
        const allUsers = usersRes.data as SupabasePortalUser[];
        setAgents(allUsers.filter((u) => u.role === 'AGENT'));
        setSubscribers(allUsers.filter((u) => u.role === 'CLIENT'));
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Failed to load inventory data from Supabase.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAllInventoryData(true);

    const channel = supabase
      .channel('public:erp_inventory_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items' }, () =>
        loadAllInventoryData(true)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendors' }, () =>
        loadAllInventoryData(true)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_purchases' }, () =>
        loadAllInventoryData(true)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_sales' }, () =>
        loadAllInventoryData(true)
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_transactions' }, () =>
        loadAllInventoryData(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadAllInventoryData]);

  // Period-filtered sales & purchases
  const filteredSalesByDate = useMemo(
    () => sales.filter((s) => matchesDateFilter(s.sale_date, dateFilter)),
    [sales, dateFilter]
  );

  const filteredPurchasesByDate = useMemo(
    () => purchases.filter((p) => matchesDateFilter(p.purchase_date, dateFilter)),
    [purchases, dateFilter]
  );

  // KPI Metrics
  const kpis = useMemo(() => {
    const stockValuation = items.reduce(
      (sum, it) => sum + (Number(it.stock_qty) || 0) * (Number(it.avg_purchase_cost) || 0),
      0
    );
    const totalUnits = items.reduce((sum, it) => sum + (Number(it.stock_qty) || 0), 0);
    const lowStockItems = items.filter(
      (it) => (Number(it.stock_qty) || 0) <= (Number(it.low_stock_alert) || 5)
    );
    const salesRevenue = filteredSalesByDate.reduce(
      (sum, s) => sum + (Number(s.total_sale) || 0),
      0
    );
    const salesNetProfit = filteredSalesByDate.reduce(
      (sum, s) => sum + (Number(s.net_profit) || 0),
      0
    );
    const totalPayables = vendors.reduce(
      (sum, v) => sum + (Number(v.balance_payable) || 0),
      0
    );
    const unpaidVendorsCount = vendors.filter((v) => (Number(v.balance_payable) || 0) > 0).length;

    return {
      stockValuation,
      totalUnits,
      lowStockCount: lowStockItems.length,
      salesRevenue,
      salesNetProfit,
      totalPayables,
      unpaidVendorsCount,
    };
  }, [items, filteredSalesByDate, vendors]);

  // Filtered table datasets
  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (categoryFilter !== 'ALL' && it.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        it.item_name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q) ||
        it.unit.toLowerCase().includes(q)
      );
    });
  }, [items, searchQuery, categoryFilter]);

  const visibleSales = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return filteredSalesByDate.filter((s) => {
      if (saleStatusFilter !== 'ALL' && s.payment_status !== saleStatusFilter) return false;
      if (!q) return true;
      return (
        (s.item_name || '').toLowerCase().includes(q) ||
        (s.subscriber_username || '').toLowerCase().includes(q) ||
        (s.customer_name || '').toLowerCase().includes(q) ||
        (s.sold_by_agent || '').toLowerCase().includes(q)
      );
    });
  }, [filteredSalesByDate, searchQuery, saleStatusFilter]);

  const visiblePurchases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return filteredPurchasesByDate.filter((p) => {
      if (purchaseStatusFilter !== 'ALL' && p.payment_status !== purchaseStatusFilter) return false;
      if (!q) return true;
      return (
        (p.item_name || '').toLowerCase().includes(q) ||
        (p.vendor_name || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      );
    });
  }, [filteredPurchasesByDate, searchQuery, purchaseStatusFilter]);

  const visibleVendors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vendors.filter((v) => {
      if (!q) return true;
      return (
        (v.vendor_name || '').toLowerCase().includes(q) ||
        (v.company_name || '').toLowerCase().includes(q) ||
        (v.phone || '').toLowerCase().includes(q)
      );
    });
  }, [vendors, searchQuery]);

  // Copy SQL
  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(ERP_MIGRATION_SQL);
      setCopiedSql(true);
      showToast('success', 'Copied ERP SQL script! Paste & run in Supabase SQL Editor.');
      setTimeout(() => setCopiedSql(false), 3000);
    } catch {
      showToast('error', 'Unable to copy automatically. Please copy from the SQL box.');
    }
  };

  // ============================================================================
  // ITEM CRUD HANDLERS
  // ============================================================================
  const openAddItemModal = () => {
    setEditingItem(null);
    setItemForm({
      item_name: '',
      category: 'ROUTER_ONT',
      unit: 'pcs',
      avg_purchase_cost: '',
      default_sale_price: '',
      stock_qty: '0',
      low_stock_alert: '5',
    });
    setIsItemModalOpen(true);
  };

  const openEditItemModal = (item: SupabaseInventoryItem) => {
    setEditingItem(item);
    setItemForm({
      item_name: item.item_name,
      category: item.category || 'ROUTER_ONT',
      unit: item.unit || 'pcs',
      avg_purchase_cost: String(item.avg_purchase_cost ?? 0),
      default_sale_price: String(item.default_sale_price ?? 0),
      stock_qty: String(item.stock_qty ?? 0),
      low_stock_alert: String(item.low_stock_alert ?? 5),
    });
    setIsItemModalOpen(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.item_name.trim()) {
      showToast('error', 'Please enter an item name.');
      return;
    }
    setIsSaving(true);
    try {
      if (editingItem) {
        await updateInventoryItem(editingItem.id, {
          item_name: itemForm.item_name,
          category: itemForm.category,
          unit: itemForm.unit,
          avg_purchase_cost: Number(itemForm.avg_purchase_cost) || 0,
          default_sale_price: Number(itemForm.default_sale_price) || 0,
          stock_qty: Number(itemForm.stock_qty) || 0,
          low_stock_alert: Number(itemForm.low_stock_alert) || 5,
        });
        showToast('success', `Updated "${itemForm.item_name}" in hardware catalog.`);
      } else {
        await createInventoryItem({
          item_name: itemForm.item_name,
          category: itemForm.category,
          unit: itemForm.unit,
          avg_purchase_cost: Number(itemForm.avg_purchase_cost) || 0,
          default_sale_price: Number(itemForm.default_sale_price) || 0,
          stock_qty: Number(itemForm.stock_qty) || 0,
          low_stock_alert: Number(itemForm.low_stock_alert) || 5,
        });
        showToast('success', `Added "${itemForm.item_name}" to hardware catalog.`);
      }
      setIsItemModalOpen(false);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to save hardware item.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deletingItem) return;
    setIsSaving(true);
    try {
      await deleteInventoryItem(deletingItem.id);
      showToast('success', `Deleted "${deletingItem.item_name}".`);
      setDeletingItem(null);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete item.');
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================================
  // HARDWARE SALE HANDLERS
  // ============================================================================
  const openAddSaleModal = (preselectedItem?: SupabaseInventoryItem) => {
    setEditingSale(null);
    const defaultItem = preselectedItem || items[0] || null;
    setSaleForm({
      item_id: defaultItem?.id || '',
      subscriber_username: '',
      customer_name: '',
      sold_by_agent: currentUser?.fullName || currentUser?.username || '',
      qty: '1',
      unit_sale_price: defaultItem ? String(defaultItem.default_sale_price) : '',
      payment_status: 'PAID',
      sale_date: getTodayDateInputValue(),
      notes: '',
    });
    setIsSaleModalOpen(true);
  };

  const openEditSaleModal = (sale: SupabaseInventorySale) => {
    setEditingSale(sale);
    setSaleForm({
      item_id: sale.item_id,
      subscriber_username: sale.subscriber_username || '',
      customer_name: sale.customer_name || '',
      sold_by_agent: sale.sold_by_agent || '',
      qty: String(sale.qty),
      unit_sale_price: String(sale.unit_sale_price),
      payment_status: sale.payment_status || 'PAID',
      sale_date: (sale.sale_date || getTodayDateInputValue()).slice(0, 10),
      notes: sale.notes || '',
    });
    setIsSaleModalOpen(true);
  };

  const selectedSaleItem = useMemo(
    () => items.find((i) => i.id === saleForm.item_id) || null,
    [items, saleForm.item_id]
  );

  const saleProfitPreview = useMemo(() => {
    const qty = Number(saleForm.qty) || 0;
    const price = Number(saleForm.unit_sale_price) || 0;
    const cost = editingSale
      ? Number(editingSale.unit_cost_snapshot) || 0
      : Number(selectedSaleItem?.avg_purchase_cost) || 0;
    return {
      totalSale: qty * price,
      cogs: qty * cost,
      netProfit: (price - cost) * qty,
    };
  }, [saleForm.qty, saleForm.unit_sale_price, editingSale, selectedSaleItem]);

  const handleSaveSale = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = Number(saleForm.qty);
    const unitPrice = Number(saleForm.unit_sale_price);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('error', 'Please enter a valid positive quantity.');
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      showToast('error', 'Please enter a valid sale price.');
      return;
    }

    setIsSaving(true);
    try {
      const isoDate = saleForm.sale_date
        ? new Date(`${saleForm.sale_date}T12:00:00`).toISOString()
        : new Date().toISOString();

      if (editingSale) {
        await updateInventorySale(editingSale, {
          subscriber_username: saleForm.subscriber_username,
          customer_name: saleForm.customer_name,
          sold_by_agent: saleForm.sold_by_agent,
          qty,
          unit_sale_price: unitPrice,
          payment_status: saleForm.payment_status,
          sale_date: isoDate,
          notes: saleForm.notes,
        });
        showToast('success', 'Hardware sale updated & stock adjusted.');
      } else {
        if (!selectedSaleItem) {
          showToast('error', 'Please select a hardware item.');
          setIsSaving(false);
          return;
        }
        await createInventorySale({
          item: selectedSaleItem,
          subscriber_username: saleForm.subscriber_username,
          customer_name: saleForm.customer_name,
          sold_by_agent: saleForm.sold_by_agent,
          qty,
          unit_sale_price: unitPrice,
          payment_status: saleForm.payment_status,
          sale_date: isoDate,
          notes: saleForm.notes,
        });
        showToast(
          'success',
          `Sold ${qty} ${selectedSaleItem.unit} × ${selectedSaleItem.item_name} (Profit: ${formatCurrency(
            saleProfitPreview.netProfit
          )})`
        );
      }
      setIsSaleModalOpen(false);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to record hardware sale.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSale = async () => {
    if (!deletingSale) return;
    setIsSaving(true);
    try {
      await deleteInventorySale(deletingSale);
      showToast('success', `Sale deleted & ${deletingSale.qty} units restored to stock.`);
      setDeletingSale(null);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete sale.');
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================================
  // STOCK PURCHASE HANDLERS
  // ============================================================================
  const openAddPurchaseModal = (preselectedItem?: SupabaseInventoryItem) => {
    const defaultItem = preselectedItem || items[0] || null;
    setPurchaseForm({
      item_id: defaultItem?.id || '',
      vendor_id: vendors[0]?.id || '',
      qty: '10',
      unit_cost: defaultItem ? String(defaultItem.avg_purchase_cost || '') : '',
      payment_status: 'PAID',
      amount_paid: '',
      purchase_date: getTodayDateInputValue(),
      notes: '',
    });
    setIsPurchaseModalOpen(true);
  };

  const selectedPurchaseItem = useMemo(
    () => items.find((i) => i.id === purchaseForm.item_id) || null,
    [items, purchaseForm.item_id]
  );

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPurchaseItem) {
      showToast('error', 'Please select an item to restock.');
      return;
    }
    const qty = Number(purchaseForm.qty);
    const unitCost = Number(purchaseForm.unit_cost);
    if (!Number.isFinite(qty) || qty <= 0) {
      showToast('error', 'Purchase quantity must be greater than zero.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      showToast('error', 'Unit cost cannot be negative.');
      return;
    }

    setIsSaving(true);
    try {
      const selectedVendor = vendors.find((v) => v.id === purchaseForm.vendor_id) || null;
      const isoDate = purchaseForm.purchase_date
        ? new Date(`${purchaseForm.purchase_date}T12:00:00`).toISOString()
        : new Date().toISOString();

      await createInventoryPurchase({
        item: selectedPurchaseItem,
        vendor: selectedVendor,
        qty,
        unit_cost: unitCost,
        payment_status: purchaseForm.payment_status,
        amount_paid:
          purchaseForm.payment_status === 'PARTIAL' ? Number(purchaseForm.amount_paid) || 0 : undefined,
        purchase_date: isoDate,
        notes: purchaseForm.notes,
      });

      showToast(
        'success',
        `Added ${qty} ${selectedPurchaseItem.unit} of "${selectedPurchaseItem.item_name}" to stock.`
      );
      setIsPurchaseModalOpen(false);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to record stock purchase.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeletePurchase = async () => {
    if (!deletingPurchase) return;
    setIsSaving(true);
    try {
      await deleteInventoryPurchase(deletingPurchase);
      showToast('success', 'Purchase removed and stock/vendor balances rolled back.');
      setDeletingPurchase(null);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete purchase.');
    } finally {
      setIsSaving(false);
    }
  };

  // ============================================================================
  // VENDOR CRUD & PAYABLES HANDLERS
  // ============================================================================
  const openAddVendorModal = () => {
    setEditingVendor(null);
    setVendorForm({ vendor_name: '', company_name: '', phone: '' });
    setIsVendorModalOpen(true);
  };

  const openEditVendorModal = (v: SupabaseVendor) => {
    setEditingVendor(v);
    setVendorForm({
      vendor_name: v.vendor_name,
      company_name: v.company_name || '',
      phone: v.phone || '',
    });
    setIsVendorModalOpen(true);
  };

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorForm.vendor_name.trim()) {
      showToast('error', 'Vendor name is required.');
      return;
    }
    setIsSaving(true);
    try {
      if (editingVendor) {
        await updateVendor(editingVendor.id, vendorForm);
        showToast('success', `Updated supplier "${vendorForm.vendor_name}".`);
      } else {
        await createVendor(vendorForm);
        showToast('success', `Added supplier "${vendorForm.vendor_name}".`);
      }
      setIsVendorModalOpen(false);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to save supplier.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteVendor = async () => {
    if (!deletingVendor) return;
    setIsSaving(true);
    try {
      await deleteVendor(deletingVendor.id);
      showToast('success', `Deleted supplier "${deletingVendor.vendor_name}".`);
      setDeletingVendor(null);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Failed to delete vendor.');
    } finally {
      setIsSaving(false);
    }
  };

  const openVendorPayModal = (v: SupabaseVendor) => {
    setPayingVendor(v);
    setVendorPayForm({
      amount: String(v.balance_payable > 0 ? v.balance_payable : ''),
      payment_method: 'CASH',
      reference_note: `Bill settlement to ${v.vendor_name}`,
      tx_date: getTodayDateInputValue(),
      postToExpenseLedger: true,
    });
  };

  const handleRecordVendorPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingVendor) return;
    const amt = Number(vendorPayForm.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      showToast('error', 'Please enter a positive payment amount.');
      return;
    }
    setIsSaving(true);
    try {
      await recordVendorPayment({
        vendor: payingVendor,
        amount: amt,
        payment_method: vendorPayForm.payment_method,
        reference_note: vendorPayForm.reference_note,
        tx_date: vendorPayForm.tx_date
          ? new Date(`${vendorPayForm.tx_date}T12:00:00`).toISOString()
          : new Date().toISOString(),
        postToExpenseLedger: vendorPayForm.postToExpenseLedger,
        recordedBy: currentUser?.fullName || currentUser?.username || 'Admin',
      });
      showToast(
        'success',
        `Paid ${formatCurrency(amt)} to ${payingVendor.vendor_name}${
          vendorPayForm.postToExpenseLedger ? ' & posted to ISP Expense Ledger' : ''
        }.`
      );
      setPayingVendor(null);
      await loadAllInventoryData(true);
    } catch (err: any) {
      showToast('error', err?.message || 'Vendor payment failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const openVendorLedgerModal = async (v: SupabaseVendor) => {
    setLedgerVendor(v);
    setIsLoadingVendorLedger(true);
    try {
      const txs = await fetchVendorTransactions(v.id);
      setVendorLedgerTxs(txs);
    } finally {
      setIsLoadingVendorLedger(false);
    }
  };

  const vendorItemPurchases = useMemo(() => {
    if (!ledgerVendor) return [];
    return purchases.filter((p) => p.vendor_id === ledgerVendor.id);
  }, [purchases, ledgerVendor]);

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Package className="w-5 h-5 text-sky-600 dark:text-cyan-400 shrink-0" />
            <span>ISP Hardware Inventory &amp; Vendor Payables</span>
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Routers/ONTs, Patch Cords, FDB Splitters, Cat6 &amp; Fiber Stock &middot; Sales Profit &amp; Supplier Credit Ledger
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsSqlModalOpen(true)}
            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5 text-amber-500" />
            <span>ERP SQL Setup</span>
          </button>

          <button
            type="button"
            onClick={() => loadAllInventoryData(false)}
            disabled={isRefreshing}
            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-600 dark:text-cyan-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => openAddSaleModal()}
            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer whitespace-nowrap shrink-0"
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>+ Record Sale</span>
          </button>

          <button
            type="button"
            onClick={() => openAddPurchaseModal()}
            className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition shadow-sm cursor-pointer whitespace-nowrap shrink-0"
          >
            <Truck className="w-3.5 h-3.5" />
            <span>+ Stock Purchase</span>
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/80 border-emerald-300 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/80 border-rose-300 dark:border-rose-700/60 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Missing Supabase Tables Auto-Detected Banner */}
      {missingTable && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs">
              <Database className="w-4 h-4 shrink-0" />
              <span>Supabase Inventory &amp; ERP Tables Not Yet Created</span>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-200/80">
              Click <strong>Copy ERP SQL</strong> and execute it once in your Supabase SQL Editor, then click Retry.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopySql}
              className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copiedSql ? 'Copied SQL!' : 'Copy ERP SQL'}</span>
            </button>
            <button
              type="button"
              onClick={() => loadAllInventoryData(false)}
              className="px-3.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 font-semibold text-xs cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/70 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-xs flex items-center justify-between gap-3">
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() => loadAllInventoryData(false)}
            className="px-2.5 py-1 rounded bg-rose-600 text-white font-semibold cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Period Filter Toolbar */}
      <DateFilterToolbar
        value={dateFilter}
        onChange={setDateFilter}
        totalCount={sales.length + purchases.length}
        filteredCount={filteredSalesByDate.length + filteredPurchasesByDate.length}
        recordLabel="hardware transactions"
      />

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Stock Valuation
            </span>
            <Package className="w-4 h-4 text-sky-600 dark:text-cyan-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {isLoading ? '—' : formatCurrency(kpis.stockValuation, 0)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
              {items.length} SKUs &middot; {kpis.totalUnits} total units
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Low Stock Alerts
            </span>
            <AlertTriangle
              className={`w-4 h-4 shrink-0 ${
                kpis.lowStockCount > 0 ? 'text-amber-500' : 'text-emerald-500'
              }`}
            />
          </div>
          <div className="mt-2">
            <div
              className={`text-xl font-bold font-mono tabular-nums ${
                kpis.lowStockCount > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {isLoading ? '—' : kpis.lowStockCount}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">
              {kpis.lowStockCount > 0 ? 'Items at or below reorder level' : 'All stock levels healthy'}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Hardware Sales &amp; Profit
            </span>
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          </div>
          <div className="mt-2">
            <div className="text-xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {isLoading ? '—' : formatCurrency(kpis.salesNetProfit, 0)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
              Rev: {formatCurrency(kpis.salesRevenue, 0)} ({describeDateFilter(dateFilter)})
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 p-4 rounded-xl flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Vendor Payables Due
            </span>
            <Building2 className="w-4 h-4 text-rose-500 shrink-0" />
          </div>
          <div className="mt-2">
            <div
              className={`text-xl font-bold font-mono tabular-nums ${
                kpis.totalPayables > 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-900 dark:text-white'
              }`}
            >
              {isLoading ? '—' : formatCurrency(kpis.totalPayables, 0)}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
              {kpis.unpaidVendorsCount} supplier{kpis.unpaidVendorsCount === 1 ? '' : 's'} with credit balance
            </p>
          </div>
        </div>
      </div>

      {/* 4 Mobile-Scrollable Sub-Tabs */}
      <div className="flex items-center overflow-x-auto gap-2 pb-1 no-scrollbar border-b border-slate-200 dark:border-slate-800">
        {(
          [
            { id: 'catalog', label: `Stock & Items Catalog (${items.length})`, icon: Package },
            { id: 'sales', label: `Hardware Sales (${filteredSalesByDate.length})`, icon: ShoppingCart },
            { id: 'purchases', label: `Stock Purchases (${filteredPurchasesByDate.length})`, icon: Truck },
            { id: 'vendors', label: `Vendor Payables Ledger (${vendors.length})`, icon: Building2 },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                isActive
                  ? 'bg-sky-600 text-white border border-sky-600 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-400/60 shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeSubTab === 'catalog'
                  ? 'Search item name, category, unit...'
                  : activeSubTab === 'sales'
                  ? 'Search item, @username, buyer, agent...'
                  : activeSubTab === 'purchases'
                  ? 'Search item, supplier, notes...'
                  : 'Search supplier name, company, phone...'
              }
              className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-sky-500"
            />
          </div>

          {activeSubTab === 'catalog' && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              <option value="ALL">All Hardware Categories</option>
              {INVENTORY_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          )}

          {activeSubTab === 'sales' && (
            <select
              value={saleStatusFilter}
              onChange={(e) => setSaleStatusFilter(e.target.value)}
              className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              <option value="ALL">All Payment Statuses</option>
              <option value="PAID">PAID</option>
              <option value="UNPAID_BILLED">UNPAID / BILLED</option>
            </select>
          )}

          {activeSubTab === 'purchases' && (
            <select
              value={purchaseStatusFilter}
              onChange={(e) => setPurchaseStatusFilter(e.target.value)}
              className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              <option value="ALL">All Purchase Terms</option>
              <option value="PAID">PAID</option>
              <option value="CREDIT_PAYABLE">CREDIT PAYABLE</option>
              <option value="PARTIAL">PARTIAL</option>
            </select>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeSubTab === 'catalog' && (
            <button
              type="button"
              onClick={openAddItemModal}
              className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Hardware Item</span>
            </button>
          )}
          {activeSubTab === 'sales' && (
            <button
              type="button"
              onClick={() => openAddSaleModal()}
              className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Record Hardware Sale</span>
            </button>
          )}
          {activeSubTab === 'purchases' && (
            <button
              type="button"
              onClick={() => openAddPurchaseModal()}
              className="px-3.5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Record Stock Purchase</span>
            </button>
          )}
          {activeSubTab === 'vendors' && (
            <button
              type="button"
              onClick={openAddVendorModal}
              className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Supplier / Vendor</span>
            </button>
          )}
        </div>
      </div>

      {/* SUB-TAB 1: STOCK & ITEMS CATALOG */}
      {activeSubTab === 'catalog' && (
        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Current Stock</th>
                  <th className="py-3 px-4 text-right">Avg Cost</th>
                  <th className="py-3 px-4 text-right">Default Sale Price</th>
                  <th className="py-3 px-4 text-right">Stock Value</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400 font-mono">
                      No hardware items found. Click &ldquo;+ Add Hardware Item&rdquo; to build your catalog.
                    </td>
                  </tr>
                ) : (
                  visibleItems.map((it) => {
                    const meta = getInventoryCategoryMeta(it.category);
                    const isLow = (Number(it.stock_qty) || 0) <= (Number(it.low_stock_alert) || 5);
                    const stockValue = (Number(it.stock_qty) || 0) * (Number(it.avg_purchase_cost) || 0);
                    return (
                      <tr key={it.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition">
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900 dark:text-white">{it.item_name}</div>
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                            Alert below {it.low_stock_alert} {it.unit}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: meta.color }}
                            />
                            <span>{meta.shortLabel}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <span
                            className={`font-bold ${
                              isLow
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {it.stock_qty} {it.unit}
                          </span>
                          {isLow && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                              LOW
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatCurrency(it.avg_purchase_cost)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-sky-700 dark:text-cyan-300 whitespace-nowrap">
                          {formatCurrency(it.default_sale_price)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(stockValue)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openAddPurchaseModal(it)}
                              className="px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/70 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 font-semibold text-[11px] cursor-pointer"
                            >
                              Restock
                            </button>
                            <button
                              type="button"
                              onClick={() => openAddSaleModal(it)}
                              className="px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 font-semibold text-[11px] cursor-pointer"
                            >
                              Sell
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditItemModal(it)}
                              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-cyan-300 border border-slate-200 dark:border-slate-700 cursor-pointer"
                              title="Edit Item"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingItem(it)}
                              className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 cursor-pointer"
                              title="Delete Item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
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
      )}

      {/* SUB-TAB 2: HARDWARE SALES */}
      {activeSubTab === 'sales' && (
        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Hardware Item</th>
                  <th className="py-3 px-4">Subscriber / Buyer</th>
                  <th className="py-3 px-4">Sold By</th>
                  <th className="py-3 px-4 text-right">Qty</th>
                  <th className="py-3 px-4 text-right">Total Sale</th>
                  <th className="py-3 px-4 text-right">Net Profit</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {visibleSales.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400 font-mono">
                      No hardware sales recorded in {describeDateFilter(dateFilter)}.
                    </td>
                  </tr>
                ) : (
                  visibleSales.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition">
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {s.sale_date ? new Date(s.sale_date).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">{s.item_name}</div>
                        <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                          Cost: {formatCurrency(s.unit_cost_snapshot)} &rarr; Price: {formatCurrency(s.unit_sale_price)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {s.subscriber_username ? (
                          <div className="font-mono font-bold text-sky-700 dark:text-cyan-400">
                            @{s.subscriber_username}
                          </div>
                        ) : null}
                        <div className="text-slate-700 dark:text-slate-300">
                          {s.customer_name || 'Walk-in Buyer'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {s.sold_by_agent || 'NOC Desk'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {s.qty}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                        {formatCurrency(s.total_sale)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                          s.net_profit >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatCurrency(s.net_profit)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                            s.payment_status === 'PAID'
                              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                              : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {s.payment_status === 'PAID' ? 'PAID' : 'UNPAID / BILLED'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditSaleModal(s)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-cyan-300 border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="Edit Sale"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingSale(s)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="Delete Sale (Restore Stock)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: STOCK PURCHASES */}
      {activeSubTab === 'purchases' && (
        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Hardware Item</th>
                  <th className="py-3 px-4">Supplier / Vendor</th>
                  <th className="py-3 px-4 text-right">Qty</th>
                  <th className="py-3 px-4 text-right">Unit Cost</th>
                  <th className="py-3 px-4 text-right">Total Cost</th>
                  <th className="py-3 px-4">Payment Terms</th>
                  <th className="py-3 px-4 text-right">Paid / Due</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {visiblePurchases.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500 dark:text-slate-400 font-mono">
                      No stock purchases logged in {describeDateFilter(dateFilter)}.
                    </td>
                  </tr>
                ) : (
                  visiblePurchases.map((p) => {
                    const due = Math.max(0, (Number(p.total_cost) || 0) - (Number(p.amount_paid) || 0));
                    return (
                      <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition">
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {p.purchase_date ? new Date(p.purchase_date).toLocaleDateString() : '—'}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">
                          {p.item_name}
                          {p.notes && (
                            <div className="text-[11px] font-normal text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                              {p.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                          {p.vendor_name || 'Direct Cash Market'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {p.qty}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatCurrency(p.unit_cost)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white whitespace-nowrap">
                          {formatCurrency(p.total_cost)}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                              p.payment_status === 'PAID'
                                ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                : p.payment_status === 'PARTIAL'
                                ? 'bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                                : 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                            }`}
                          >
                            {p.payment_status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-emerald-600 dark:text-emerald-400">
                            Paid: {formatCurrency(p.amount_paid)}
                          </div>
                          {due > 0 && (
                            <div className="text-[10px] text-rose-600 dark:text-rose-400 font-bold">
                              Due: {formatCurrency(due)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setDeletingPurchase(p)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="Delete Purchase & Rollback Stock"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUB-TAB 4: VENDOR PAYABLES LEDGER */}
      {activeSubTab === 'vendors' && (
        <div className="bg-white dark:bg-[#111A2E] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-4">Supplier / Vendor</th>
                  <th className="py-3 px-4">Phone</th>
                  <th className="py-3 px-4 text-right">Total Purchased</th>
                  <th className="py-3 px-4 text-right">Total Paid</th>
                  <th className="py-3 px-4 text-right">Balance Payable</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80 dark:divide-slate-800/80">
                {visibleVendors.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-500 dark:text-slate-400 font-mono">
                      No suppliers added yet. Click &ldquo;+ Add Supplier / Vendor&rdquo; to track credit payables.
                    </td>
                  </tr>
                ) : (
                  visibleVendors.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-white">{v.vendor_name}</div>
                        {v.company_name && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {v.company_name}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {v.phone ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {v.phone}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {formatCurrency(v.total_purchased)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {formatCurrency(v.total_paid)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap">
                        <span
                          className={
                            v.balance_payable > 0
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          {formatCurrency(v.balance_payable)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openVendorPayModal(v)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer transition"
                          >
                            <DollarSign className="w-3 h-3" />
                            <span>Pay Vendor</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openVendorLedgerModal(v)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-sky-300 border border-slate-200 dark:border-slate-700 font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer transition"
                          >
                            <History className="w-3 h-3" />
                            <span>Ledger</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditVendorModal(v)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-cyan-300 border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="Edit Supplier"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingVendor(v)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-600 dark:text-rose-400 border border-slate-200 dark:border-slate-700 cursor-pointer"
                            title="Delete Supplier"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 1: ADD / EDIT HARDWARE ITEM                                      */}
      {/* ====================================================================== */}
      {isItemModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-sky-500" />
                <span>{editingItem ? 'Edit Hardware Item' : 'Add Hardware Item'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsItemModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Item Name *
                </label>
                <input
                  type="text"
                  required
                  value={itemForm.item_name}
                  onChange={(e) => setItemForm((p) => ({ ...p, item_name: e.target.value }))}
                  placeholder="e.g., Tenda F3 Router / Huawei EG8141A5 ONT / 1:8 PLC Splitter"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Category
                  </label>
                  <select
                    value={itemForm.category}
                    onChange={(e) => setItemForm((p) => ({ ...p, category: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  >
                    {INVENTORY_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Unit
                  </label>
                  <select
                    value={itemForm.unit}
                    onChange={(e) => setItemForm((p) => ({ ...p, unit: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="pcs">pcs (Pieces)</option>
                    <option value="meters">meters (Cable Length)</option>
                    <option value="box">box (Roll / Carton)</option>
                    <option value="rolls">rolls (Drum)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Avg Cost (Rs.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={itemForm.avg_purchase_cost}
                    onChange={(e) =>
                      setItemForm((p) => ({ ...p, avg_purchase_cost: e.target.value }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Sale Price (Rs.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={itemForm.default_sale_price}
                    onChange={(e) =>
                      setItemForm((p) => ({ ...p, default_sale_price: e.target.value }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Stock Qty
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={itemForm.stock_qty}
                    onChange={(e) => setItemForm((p) => ({ ...p, stock_qty: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Low Alert
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={itemForm.low_stock_alert}
                    onChange={(e) =>
                      setItemForm((p) => ({ ...p, low_stock_alert: e.target.value }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsItemModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : editingItem ? 'Update Item' : 'Save Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 2: RECORD / EDIT HARDWARE SALE                                   */}
      {/* ====================================================================== */}
      {isSaleModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-500" />
                <span>{editingSale ? 'Edit Hardware Sale' : 'Record Hardware Sale'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsSaleModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSale} className="p-5 space-y-3.5 text-xs overflow-y-auto">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Hardware Item *
                </label>
                <select
                  value={saleForm.item_id}
                  disabled={!!editingSale}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const found = items.find((it) => it.id === nextId);
                    setSaleForm((p) => ({
                      ...p,
                      item_id: nextId,
                      unit_sale_price: found ? String(found.default_sale_price) : p.unit_sale_price,
                    }));
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-70"
                >
                  <option value="">-- Select Hardware Item --</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.item_name} (Stock: {it.stock_qty} {it.unit} | Cost: Rs. {it.avg_purchase_cost})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Subscriber @Username (Optional)
                  </label>
                  <input
                    type="text"
                    list="erp-subscriber-usernames"
                    value={saleForm.subscriber_username}
                    onChange={(e) => {
                      const val = e.target.value;
                      const match = subscribers.find(
                        (s) => s.username.toLowerCase() === val.toLowerCase()
                      );
                      setSaleForm((p) => ({
                        ...p,
                        subscriber_username: val,
                        customer_name: match?.full_name || p.customer_name,
                      }));
                    }}
                    placeholder="Type or select @subscriber"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <datalist id="erp-subscriber-usernames">
                    {subscribers.map((s) => (
                      <option key={s.id} value={s.username}>
                        {s.full_name} ({s.area || 'Subscriber'})
                      </option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Customer / Walk-in Buyer Name
                  </label>
                  <input
                    type="text"
                    value={saleForm.customer_name}
                    onChange={(e) => setSaleForm((p) => ({ ...p, customer_name: e.target.value }))}
                    placeholder="Walk-in Buyer or Client Name"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Qty *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="any"
                    value={saleForm.qty}
                    onChange={(e) => setSaleForm((p) => ({ ...p, qty: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Unit Sale Price (Rs.) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={saleForm.unit_sale_price}
                    onChange={(e) => setSaleForm((p) => ({ ...p, unit_sale_price: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Payment Status
                  </label>
                  <select
                    value={saleForm.payment_status}
                    onChange={(e) =>
                      setSaleForm((p) => ({
                        ...p,
                        payment_status: e.target.value as InventorySalePaymentStatus,
                      }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="PAID">PAID</option>
                    <option value="UNPAID_BILLED">UNPAID / BILLED</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Sold By (Agent / Staff)
                  </label>
                  <select
                    value={saleForm.sold_by_agent}
                    onChange={(e) => setSaleForm((p) => ({ ...p, sold_by_agent: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="">NOC Desk / Direct</option>
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.full_name || ag.username}>
                        {ag.full_name} (@{ag.username})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Sale Date
                  </label>
                  <input
                    type="date"
                    value={saleForm.sale_date}
                    onChange={(e) => setSaleForm((p) => ({ ...p, sale_date: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              {/* Live Profit Preview */}
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 grid grid-cols-3 gap-2 font-mono text-[11px]">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">Total Sale</span>
                  <strong className="text-slate-900 dark:text-white">
                    {formatCurrency(saleProfitPreview.totalSale)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">Cost (COGS)</span>
                  <strong className="text-slate-700 dark:text-slate-300">
                    {formatCurrency(saleProfitPreview.cogs)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block">Net Profit</span>
                  <strong
                    className={
                      saleProfitPreview.netProfit >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }
                  >
                    {formatCurrency(saleProfitPreview.netProfit)}
                  </strong>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={saleForm.notes}
                  onChange={(e) => setSaleForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Serial number, MAC, or installation location..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSaleModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : editingSale ? 'Update Sale' : 'Confirm Sale'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 3: RECORD STOCK PURCHASE                                         */}
      {/* ====================================================================== */}
      {isPurchaseModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Truck className="w-4 h-4 text-sky-500" />
                <span>Record Hardware Stock Purchase (Stock In)</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsPurchaseModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePurchase} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Hardware Item *
                </label>
                <select
                  required
                  value={purchaseForm.item_id}
                  onChange={(e) => {
                    const found = items.find((i) => i.id === e.target.value);
                    setPurchaseForm((p) => ({
                      ...p,
                      item_id: e.target.value,
                      unit_cost: found ? String(found.avg_purchase_cost || '') : p.unit_cost,
                    }));
                  }}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="">-- Select Item --</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.item_name} (Current Stock: {it.stock_qty} {it.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Supplier / Vendor
                </label>
                <select
                  value={purchaseForm.vendor_id}
                  onChange={(e) => setPurchaseForm((p) => ({ ...p, vendor_id: e.target.value }))}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="">Direct Cash Market (No Vendor Ledger)</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vendor_name}
                      {v.company_name ? ` (${v.company_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Qty *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="any"
                    value={purchaseForm.qty}
                    onChange={(e) => setPurchaseForm((p) => ({ ...p, qty: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Unit Cost (Rs.) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={purchaseForm.unit_cost}
                    onChange={(e) => setPurchaseForm((p) => ({ ...p, unit_cost: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Total Bill (Rs.)
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono font-bold text-slate-900 dark:text-white">
                    {formatCurrency(
                      (Number(purchaseForm.qty) || 0) * (Number(purchaseForm.unit_cost) || 0)
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Payment Status
                  </label>
                  <select
                    value={purchaseForm.payment_status}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({
                        ...p,
                        payment_status: e.target.value as InventoryPurchasePaymentStatus,
                      }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                  >
                    <option value="PAID">PAID (Full Cash / Bank)</option>
                    <option value="CREDIT_PAYABLE">CREDIT PAYABLE (Add to Vendor Due)</option>
                    <option value="PARTIAL">PARTIAL PAYMENT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Purchase Date
                  </label>
                  <input
                    type="date"
                    value={purchaseForm.purchase_date}
                    onChange={(e) =>
                      setPurchaseForm((p) => ({ ...p, purchase_date: e.target.value }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              {purchaseForm.payment_status === 'PARTIAL' && (
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Amount Paid Now (Rs.) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="any"
                    value={purchaseForm.amount_paid}
                    onChange={(e) => setPurchaseForm((p) => ({ ...p, amount_paid: e.target.value }))}
                    placeholder="Remaining balance will be added to Vendor Payables"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              )}

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Invoice / Batch Notes
                </label>
                <input
                  type="text"
                  value={purchaseForm.notes}
                  onChange={(e) => setPurchaseForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Supplier bill # or batch warranty details..."
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPurchaseModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Recording...' : 'Confirm Stock Purchase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 4: ADD / EDIT VENDOR                                             */}
      {/* ====================================================================== */}
      {isVendorModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-indigo-500" />
                <span>{editingVendor ? 'Edit Supplier / Vendor' : 'Add Supplier / Vendor'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsVendorModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveVendor} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Vendor / Contact Name *
                </label>
                <input
                  type="text"
                  required
                  value={vendorForm.vendor_name}
                  onChange={(e) => setVendorForm((p) => ({ ...p, vendor_name: e.target.value }))}
                  placeholder="e.g., Bilal Telecom Wholesale"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Company / Shop Name
                </label>
                <input
                  type="text"
                  value={vendorForm.company_name}
                  onChange={(e) => setVendorForm((p) => ({ ...p, company_name: e.target.value }))}
                  placeholder="e.g., Hall Road Fiber Depot"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  value={vendorForm.phone}
                  onChange={(e) => setVendorForm((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+92 300 0000000"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsVendorModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 5: RECORD VENDOR PAYMENT                                         */}
      {/* ====================================================================== */}
      {payingVendor && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-500" />
                <span>Record Payment to {payingVendor.vendor_name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setPayingVendor(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRecordVendorPayment} className="p-5 space-y-3.5 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between font-mono">
                <span className="text-slate-500 dark:text-slate-400">Current Balance Payable:</span>
                <strong className="text-rose-600 dark:text-rose-400">
                  {formatCurrency(payingVendor.balance_payable)}
                </strong>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Payment Amount (Rs.) *
                  </label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="any"
                    value={vendorPayForm.amount}
                    onChange={(e) => setVendorPayForm((p) => ({ ...p, amount: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    Payment Date
                  </label>
                  <input
                    type="date"
                    value={vendorPayForm.tx_date}
                    onChange={(e) => setVendorPayForm((p) => ({ ...p, tx_date: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Payment Method
                </label>
                <select
                  value={vendorPayForm.payment_method}
                  onChange={(e) =>
                    setVendorPayForm((p) => ({
                      ...p,
                      payment_method: e.target.value as IspExpensePaymentMethod,
                    }))
                  }
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                >
                  <option value="CASH">Cash</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="JAZZCASH_EASYPAISA">JazzCash / Easypaisa</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  Reference Note
                </label>
                <input
                  type="text"
                  value={vendorPayForm.reference_note}
                  onChange={(e) =>
                    setVendorPayForm((p) => ({ ...p, reference_note: e.target.value }))
                  }
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white"
                />
              </div>

              <label className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={vendorPayForm.postToExpenseLedger}
                  onChange={(e) =>
                    setVendorPayForm((p) => ({ ...p, postToExpenseLedger: e.target.checked }))
                  }
                  className="rounded border-slate-400"
                />
                <span className="text-slate-700 dark:text-slate-300">
                  Also record cash outflow in ISP Expense Ledger (<code>isp_expenses</code>)
                </span>
              </label>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setPayingVendor(null)}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Processing...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 6: VENDOR LEDGER & ITEM-WISE PURCHASE HISTORY                    */}
      {/* ====================================================================== */}
      {ledgerVendor && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg md:max-w-3xl max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-sky-500" />
                  <span>Vendor Statement &amp; Item Purchase History — {ledgerVendor.vendor_name}</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                  Purchased: {formatCurrency(ledgerVendor.total_purchased)} &middot; Paid:{' '}
                  {formatCurrency(ledgerVendor.total_paid)} &middot; Balance Due:{' '}
                  <strong className="text-rose-600 dark:text-rose-400">
                    {formatCurrency(ledgerVendor.balance_payable)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLedgerVendor(null)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 text-xs">
              {/* Ledger Transactions */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Account Ledger (Bills vs. Payments)</span>
                </h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Type</th>
                        <th className="py-2 px-3">Reference Note</th>
                        <th className="py-2 px-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 font-mono">
                      {isLoadingVendorLedger ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-slate-500">
                            Loading vendor ledger...
                          </td>
                        </tr>
                      ) : vendorLedgerTxs.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-slate-500">
                            No ledger transactions recorded yet.
                          </td>
                        </tr>
                      ) : (
                        vendorLedgerTxs.map((tx) => {
                          const isPayment = tx.tx_type === 'PAYMENT_PAID';
                          return (
                            <tr key={tx.id}>
                              <td className="py-2 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                {new Date(tx.tx_date).toLocaleDateString()}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isPayment
                                      ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                                  }`}
                                >
                                  {isPayment ? (
                                    <ArrowUpRight className="w-3 h-3" />
                                  ) : (
                                    <ArrowDownLeft className="w-3 h-3" />
                                  )}
                                  {tx.tx_type.replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td className="py-2 px-3 font-sans text-slate-700 dark:text-slate-300">
                                {tx.reference_note || '—'}
                              </td>
                              <td
                                className={`py-2 px-3 text-right font-bold tabular-nums whitespace-nowrap ${
                                  isPayment
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-rose-600 dark:text-rose-400'
                                }`}
                              >
                                {isPayment ? '-' : '+'}
                                {formatCurrency(tx.amount)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Item-Wise Purchase Breakdown */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-sky-500" />
                  <span>Item-Wise Purchased History ({vendorItemPurchases.length})</span>
                </h4>
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Item</th>
                        <th className="py-2 px-3 text-right">Qty</th>
                        <th className="py-2 px-3 text-right">Unit Cost</th>
                        <th className="py-2 px-3 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 font-mono">
                      {vendorItemPurchases.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-slate-500">
                            No hardware purchases linked to this supplier yet.
                          </td>
                        </tr>
                      ) : (
                        vendorItemPurchases.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                              {new Date(p.purchase_date).toLocaleDateString()}
                            </td>
                            <td className="py-2 px-3 font-sans font-semibold text-slate-900 dark:text-white">
                              {p.item_name}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                              {p.qty}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums text-slate-700 dark:text-slate-300">
                              {formatCurrency(p.unit_cost)}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums font-bold text-slate-900 dark:text-white">
                              {formatCurrency(p.total_cost)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* MODAL 7: ONE-CLICK ERP SQL SETUP MODAL                                 */}
      {/* ====================================================================== */}
      {isSqlModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg md:max-w-3xl max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Supabase ERP SQL Migration (Commissions + Inventory + Vendor Ledger)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSqlModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto text-xs">
              <p className="text-slate-600 dark:text-slate-300">
                Run this idempotent SQL script in your <strong>Supabase SQL Editor</strong> to create{' '}
                <code>agent_commissions</code>, <code>inventory_items</code>, <code>vendors</code>,{' '}
                <code>vendor_transactions</code>, <code>inventory_purchases</code>, and{' '}
                <code>inventory_sales</code> with full Realtime sync.
              </p>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleCopySql}
                  className="px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedSql ? 'Copied ERP SQL!' : 'Copy Full ERP SQL'}</span>
                </button>
              </div>
              <pre className="w-full max-w-full p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-emerald-300 font-mono text-[11px] overflow-x-auto max-h-[50vh]">
                {ERP_MIGRATION_SQL}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================== */}
      {/* DELETE CONFIRMATIONS (ITEM / SALE / PURCHASE / VENDOR)                 */}
      {/* ====================================================================== */}
      {(deletingItem || deletingSale || deletingPurchase || deletingVendor) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 overflow-y-auto">
          <div className="w-[95vw] sm:w-full max-w-lg max-h-[90vh] overflow-y-auto mx-auto my-auto rounded-2xl box-border bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-800 shadow-2xl p-4 sm:p-5 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Confirm Permanent Deletion
                </h3>
                <p className="text-slate-600 dark:text-slate-300 mt-1">
                  {deletingItem &&
                    `Delete hardware item "${deletingItem.item_name}" and all linked history?`}
                  {deletingSale &&
                    `Delete sale of ${deletingSale.qty} × "${deletingSale.item_name}"? Sold units will be restored to stock.`}
                  {deletingPurchase &&
                    `Delete purchase of ${deletingPurchase.qty} × "${deletingPurchase.item_name}"? Stock & vendor payable totals will roll back.`}
                  {deletingVendor &&
                    `Delete supplier "${deletingVendor.vendor_name}" and all its transaction ledger entries?`}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  setDeletingItem(null);
                  setDeletingSale(null);
                  setDeletingPurchase(null);
                  setDeletingVendor(null);
                }}
                className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => {
                  if (deletingItem) handleDeleteItem();
                  else if (deletingSale) handleDeleteSale();
                  else if (deletingPurchase) handleDeletePurchase();
                  else if (deletingVendor) handleDeleteVendor();
                }}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold cursor-pointer disabled:opacity-50"
              >
                {isSaving ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InventoryHardwareView;
