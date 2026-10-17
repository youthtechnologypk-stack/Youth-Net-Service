import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  PlusCircle,
  Trash2,
  Package,
  Wrench,
  Wifi,
  Cable,
  Box,
  Layers,
  Send,
  ShieldCheck,
  Check,
  Hash,
  DollarSign,
  AlertCircle,
} from 'lucide-react';
import { useISP } from '../context/ISPContext';
import { useCurrency } from '../context/CurrencyContext';
import { InvoiceStatus, InvoiceLineItem, InvoiceItemCategory } from '../types/isp';

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCustomerId?: string;
  defaultBillingMonth?: string;
}

interface ItemPreset {
  category: InvoiceItemCategory;
  label: string;
  defaultDesc: string;
  defaultRate: number;
  unit: string;
  hasSerial?: boolean;
}

const ITEM_PRESETS: ItemPreset[] = [
  {
    category: 'monthly_subscription',
    label: 'Monthly Internet Package',
    defaultDesc: 'Monthly Internet Subscription',
    defaultRate: 45.0,
    unit: 'month',
  },
  {
    category: 'installation_fee',
    label: 'New Connection Installation Fee',
    defaultDesc: 'Fiber Drop Installation, Splicing & Optical Termination',
    defaultRate: 20.0,
    unit: 'service',
  },
  {
    category: 'router_onu_ont',
    label: 'Fiber Router Sale / ONU / ONT Device',
    defaultDesc: 'Dual-Band XPON ONU / Gigabit ONT Router',
    defaultRate: 65.0,
    unit: 'pcs',
    hasSerial: true,
  },
  {
    category: 'fiber_cable',
    label: 'Fiber Optic Cable (Drop/Armored)',
    defaultDesc: 'Drop Fiber Optic Cable 2-Core G657A2',
    defaultRate: 0.5,
    unit: 'meter',
  },
  {
    category: 'patch_cord',
    label: 'Patch Cord (SC-SC / SC-LC)',
    defaultDesc: 'Patch Cord SC-UPC to SC-APC Single Mode (3m)',
    defaultRate: 5.0,
    unit: 'pcs',
  },
  {
    category: 'joint_box_splitter',
    label: 'Joint Closure / Distribution / Splitter Box',
    defaultDesc: 'Optical Splitter Box 1:4 / 1:8 Mini Cassette & Distribution Box',
    defaultRate: 18.0,
    unit: 'pcs',
  },
  {
    category: 'custom_hardware',
    label: 'Custom Hardware / Maintenance Charge',
    defaultDesc: 'Custom Hardware Replacement & On-site Maintenance',
    defaultRate: 15.0,
    unit: 'service',
  },
];

export const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({
  isOpen,
  onClose,
  defaultCustomerId,
  defaultBillingMonth,
}) => {
  const { customers, packages, createInvoice } = useISP();
  const { formatCurrency, currencySymbol } = useCurrency();

  const now = new Date();
  const currentMonthName = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  const defaultDueDate = new Date(now.getFullYear(), now.getMonth(), 10).toISOString().split('T')[0];

  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(
    defaultCustomerId || customers[0]?.id || ''
  );
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [packageId, setPackageId] = useState(packages[1]?.id || packages[0]?.id || '');
  const [packageName, setPackageName] = useState('');
  const [billingMonth, setBillingMonth] = useState(defaultBillingMonth || currentMonthName);
  const [status, setStatus] = useState<InvoiceStatus>('unpaid');
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [sendWhatsApp, setSendWhatsApp] = useState(true);

  // Line Items state
  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    {
      id: `li-${Date.now()}-1`,
      category: 'monthly_subscription',
      description: 'Monthly Internet Package (50 Mbps Turbo Gamer)',
      quantity: 1,
      unitPrice: 45.0,
      totalPrice: 45.0,
      unit: 'month',
    },
  ]);

  // Tax & Discount
  const [applyTax, setApplyTax] = useState(true);
  const [taxPercent, setTaxPercent] = useState<number>(16); // 16% Telecom GST
  const [customTaxAmount, setCustomTaxAmount] = useState<number | null>(null);
  const [discountAmount, setDiscountAmount] = useState<number>(0);

  // Synchronize when customer changes
  useEffect(() => {
    const cust = customers.find((c) => c.id === selectedCustomerId) || customers[0];
    if (cust) {
      setCustomerName(cust.name);
      setCustomerPhone(cust.phone);
      const pkg = packages.find((p) => p.id === cust.packageId) || packages[0];
      if (pkg) {
        setPackageId(pkg.id);
        setPackageName(pkg.name);

        // Update default subscription line item if only 1 item exists and it's subscription
        setLineItems((prev) => {
          if (prev.length === 1 && prev[0].category === 'monthly_subscription') {
            return [
              {
                id: prev[0].id,
                category: 'monthly_subscription',
                description: `Monthly Internet Package (${pkg.name})`,
                quantity: 1,
                unitPrice: pkg.priceMonthly,
                totalPrice: pkg.priceMonthly,
                unit: 'month',
              },
            ];
          }
          return prev;
        });
      }
      const invNum = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${cust.accountNumber.slice(-4)}`;
      setInvoiceNumber(invNum);
    }
  }, [selectedCustomerId, customers, packages]);

  // Recalculate totals
  const subtotalBase = useMemo(() => {
    return lineItems.reduce((acc, item) => acc + (Number(item.totalPrice) || 0), 0);
  }, [lineItems]);

  const calculatedTax = useMemo(() => {
    if (!applyTax) return 0;
    if (customTaxAmount !== null) return customTaxAmount;
    return Math.round(subtotalBase * (taxPercent / 100) * 10) / 10;
  }, [applyTax, customTaxAmount, subtotalBase, taxPercent]);

  const totalAmount = useMemo(() => {
    return Math.max(0, subtotalBase + calculatedTax - (Number(discountAmount) || 0));
  }, [subtotalBase, calculatedTax, discountAmount]);

  if (!isOpen) return null;

  // Add line item
  const handleAddLineItem = (presetCategory: InvoiceItemCategory = 'router_onu_ont') => {
    const preset = ITEM_PRESETS.find((p) => p.category === presetCategory) || ITEM_PRESETS[1];
    const newItem: InvoiceLineItem = {
      id: `li-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      category: preset.category,
      description: preset.defaultDesc,
      quantity: preset.category === 'fiber_cable' ? 50 : 1,
      unitPrice: preset.defaultRate,
      totalPrice: (preset.category === 'fiber_cable' ? 50 : 1) * preset.defaultRate,
      unit: preset.unit,
      serialNumber: preset.hasSerial ? '' : undefined,
    };
    setLineItems((prev) => [...prev, newItem]);
  };

  const handleRemoveLineItem = (id: string) => {
    if (lineItems.length <= 1) {
      alert('Invoice must have at least one line item.');
      return;
    }
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateLineItem = (id: string, updates: Partial<InvoiceLineItem>) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        let newCategory = updates.category !== undefined ? updates.category : item.category;
        let newQty = updates.quantity !== undefined ? Number(updates.quantity) : item.quantity;
        let newPrice = updates.unitPrice !== undefined ? Number(updates.unitPrice) : item.unitPrice;
        let newDesc = updates.description !== undefined ? updates.description : item.description;
        let newSerial = updates.serialNumber !== undefined ? updates.serialNumber : item.serialNumber;
        let newUnit = updates.unit !== undefined ? updates.unit : item.unit;

        // If category changed, update default description & unit
        if (updates.category && updates.category !== item.category) {
          const matchedPreset = ITEM_PRESETS.find((p) => p.category === updates.category);
          if (matchedPreset) {
            newDesc = matchedPreset.defaultDesc;
            newPrice = matchedPreset.defaultRate;
            newUnit = matchedPreset.unit;
            newSerial = matchedPreset.hasSerial ? '' : undefined;
          }
        }

        const totalPrice = Math.round(newQty * newPrice * 100) / 100;

        return {
          ...item,
          category: newCategory,
          description: newDesc,
          quantity: newQty,
          unitPrice: newPrice,
          totalPrice,
          serialNumber: newSerial,
          unit: newUnit,
        };
      })
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName || !invoiceNumber) return;

    createInvoice({
      invoiceNumber,
      customerId: selectedCustomerId,
      customerName,
      customerPhone,
      packageId,
      packageName,
      billingMonth,
      baseAmount: subtotalBase,
      taxAmount: calculatedTax,
      discountAmount: Number(discountAmount) || 0,
      totalAmount,
      status,
      dueDate,
      issuedAt: new Date().toISOString(),
      paidAt: status === 'paid' ? new Date().toISOString() : undefined,
      whatsappNoticeSent: sendWhatsApp,
      whatsappNoticeTimestamp: sendWhatsApp ? new Date().toISOString() : undefined,
      lineItems,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl my-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 rounded-xl shadow-inner">
              <PlusCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Generate Custom Invoice / Charge
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-900/60 text-cyan-300 border border-cyan-700/40">
                  Multi-Line Items
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Support for monthly internet, fiber cables, ONUs/routers, patch cords & installation fees
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Invoice Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 text-xs">
          {/* Top Row: Customer Selection & Invoice # */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
            <div className="sm:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">Subscriber Account</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} &bull; @{c.pppoeUsername} ({c.accountNumber})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1 font-mono">Invoice Number</label>
              <input
                type="text"
                required
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-cyan-300 font-mono p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>
          </div>

          {/* Month, Status & Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Billing Cycle / Month</label>
              <input
                type="text"
                required
                value={billingMonth}
                onChange={(e) => setBillingMonth(e.target.value)}
                placeholder="e.g. October 2026"
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Due Date</label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Payment Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                className="w-full bg-slate-950 border border-slate-700 text-slate-100 p-2 rounded-lg focus:outline-none focus:border-cyan-500 text-xs capitalize"
              >
                <option value="unpaid">Unpaid (Outstanding Due)</option>
                <option value="paid">Paid (Instant Cash/Bank)</option>
                <option value="overdue">Overdue (Walled Garden Trigger)</option>
              </select>
            </div>
          </div>

          {/* HARDWARE & INSTALLATION LINE ITEMS BUILDER */}
          <div className="bg-slate-950 p-3 sm:p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div>
                <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-cyan-400" />
                  Itemized Charges & Hardware Breakdown
                </span>
                <span className="text-[11px] text-slate-400 block">
                  Add fiber routers, drop cables, installation charges, and maintenance items
                </span>
              </div>

              {/* Quick Preset Dropdown / Add Button */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAddLineItem('router_onu_ont')}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-cyan-950 text-cyan-300 hover:bg-cyan-900 border border-cyan-800 rounded-lg flex items-center gap-1 transition"
                >
                  <Wifi className="w-3 h-3" />
                  <span>+ Router/ONT</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddLineItem('fiber_cable')}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-950 text-emerald-300 hover:bg-emerald-900 border border-emerald-800 rounded-lg flex items-center gap-1 transition"
                >
                  <Cable className="w-3 h-3" />
                  <span>+ Fiber Cable</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAddLineItem('installation_fee')}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-950 text-indigo-300 hover:bg-indigo-900 border border-indigo-800 rounded-lg flex items-center gap-1 transition"
                >
                  <Wrench className="w-3 h-3" />
                  <span>+ Installation</span>
                </button>
              </div>
            </div>

            {/* Line items list */}
            <div className="space-y-2.5">
              {lineItems.map((item, index) => (
                <div
                  key={item.id}
                  className="bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 p-3 rounded-lg space-y-2 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 font-mono text-[10px] flex items-center justify-center font-bold">
                        {index + 1}
                      </span>

                      {/* Category selector */}
                      <select
                        value={item.category}
                        onChange={(e) =>
                          handleUpdateLineItem(item.id, {
                            category: e.target.value as InvoiceItemCategory,
                          })
                        }
                        className="bg-slate-950 border border-slate-700 text-cyan-300 text-xs px-2 py-1 rounded font-medium focus:outline-none focus:border-cyan-500"
                      >
                        {ITEM_PRESETS.map((p) => (
                          <option key={p.category} value={p.category}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveLineItem(item.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition"
                      title="Remove Item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                    {/* Item Description */}
                    <div className="sm:col-span-6">
                      <input
                        type="text"
                        placeholder="Item description / Model..."
                        value={item.description}
                        onChange={(e) =>
                          handleUpdateLineItem(item.id, { description: e.target.value })
                        }
                        className="w-full bg-slate-950 border border-slate-800 text-slate-100 px-2.5 py-1.5 rounded text-xs focus:outline-none focus:border-cyan-500"
                      />
                    </div>

                    {/* Qty */}
                    <div className="sm:col-span-2">
                      <div className="flex items-center bg-slate-950 border border-slate-800 rounded px-2 py-1">
                        <span className="text-[10px] text-slate-500 mr-1">Qty</span>
                        <input
                          type="number"
                          min="0.1"
                          step="any"
                          value={item.quantity}
                          onChange={(e) =>
                            handleUpdateLineItem(item.id, {
                              quantity: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full bg-transparent text-slate-100 text-xs font-mono focus:outline-none text-right"
                        />
                      </div>
                    </div>

                    {/* Unit Rate */}
                    <div className="sm:col-span-2">
                      <div className="flex items-center bg-slate-950 border border-slate-800 rounded px-2 py-1">
                        <span className="text-[10px] text-slate-500 mr-1">Rate</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) =>
                            handleUpdateLineItem(item.id, {
                              unitPrice: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full bg-transparent text-slate-100 text-xs font-mono focus:outline-none text-right"
                        />
                      </div>
                    </div>

                    {/* Row Total */}
                    <div className="sm:col-span-2 text-right">
                      <div className="text-emerald-400 font-mono font-bold text-xs">
                        {formatCurrency(item.totalPrice)}
                      </div>
                      <span className="text-[10px] text-slate-500">
                        ({item.quantity} {item.unit || 'units'})
                      </span>
                    </div>
                  </div>

                  {/* Optional Serial Number / MAC Address for ONUs / Hardware */}
                  {(item.category === 'router_onu_ont' || item.serialNumber !== undefined) && (
                    <div className="pt-1 flex items-center gap-2">
                      <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                        <Hash className="w-3 h-3 text-cyan-400" />
                        Hardware S/N or MAC (Optional):
                      </span>
                      <input
                        type="text"
                        placeholder="e.g. HWTC-9281A48F / 48:8F:5A:21:00:1E"
                        value={item.serialNumber || ''}
                        onChange={(e) =>
                          handleUpdateLineItem(item.id, { serialNumber: e.target.value })
                        }
                        className="flex-1 bg-slate-950 border border-slate-800 text-cyan-300 font-mono px-2 py-0.5 rounded text-[11px] focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom Add Line Item Button */}
            <div className="pt-1 flex justify-start">
              <button
                type="button"
                onClick={() => handleAddLineItem('custom_hardware')}
                className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-800 transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                <span>+ Add Another Custom Line Item</span>
              </button>
            </div>
          </div>

          {/* FINANCIAL SUMMARY & TAX / DISCOUNT */}
          <div className="bg-slate-950 p-3 sm:p-4 rounded-xl border border-slate-800 space-y-3 font-mono">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Subtotal Base */}
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-sans">
                  Subtotal (Base Items)
                </span>
                <span className="text-white font-bold text-sm block mt-0.5">
                  {formatCurrency(subtotalBase)}
                </span>
                <span className="text-[10px] text-slate-500 font-sans">
                  {lineItems.length} line items total
                </span>
              </div>

              {/* Tax Settings */}
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-sans">Telecom Tax / GST</span>
                  <label className="flex items-center gap-1 cursor-pointer text-[10px] text-cyan-400 font-sans">
                    <input
                      type="checkbox"
                      checked={applyTax}
                      onChange={(e) => setApplyTax(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
                    />
                    <span>Apply</span>
                  </label>
                </div>
                {applyTax ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={taxPercent}
                      onChange={(e) => {
                        setTaxPercent(parseFloat(e.target.value) || 0);
                        setCustomTaxAmount(null);
                      }}
                      className="w-14 bg-slate-950 border border-slate-700 text-slate-100 px-1 py-0.5 rounded text-xs text-right"
                    />
                    <span className="text-slate-400 text-xs">%</span>
                    <span className="text-cyan-300 font-bold text-xs ml-auto">
                      +{formatCurrency(calculatedTax)}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] text-slate-500 font-sans">Tax Exempt / 0%</span>
                )}
              </div>

              {/* Discount Field */}
              <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[10px] text-slate-400 block font-sans">
                  Promotional Discount ({currencySymbol})
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-700 text-amber-300 font-mono p-1 rounded text-xs mt-1 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            {/* Total Payable Banner */}
            <div className="flex items-center justify-between p-3 bg-gradient-to-r from-emerald-950/60 to-slate-900 border border-emerald-800/40 rounded-xl">
              <div>
                <span className="text-xs text-slate-300 font-sans font-medium block">
                  Total Final Payable Amount
                </span>
                <span className="text-[10px] text-emerald-400/80 font-sans">
                  Includes base packages, equipment, cables, and applicable taxes
                </span>
              </div>
              <div className="text-right">
                <span className="text-xl font-black text-emerald-400 block">
                  {formatCurrency(totalAmount)}
                </span>
                <span className="text-[10px] text-slate-400 font-sans uppercase tracking-wider">
                  Status: {status}
                </span>
              </div>
            </div>
          </div>

          {/* WhatsApp dispatch toggle */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
              />
              <span className="flex items-center gap-1.5 text-xs">
                <Send className="w-3.5 h-3.5 text-emerald-400" />
                <span>Send WhatsApp itemized bill statement to {customerPhone || 'customer'}</span>
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 font-medium text-xs transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold transition shadow-lg flex items-center gap-2 text-xs"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Generate &amp; Save Itemized Invoice</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
