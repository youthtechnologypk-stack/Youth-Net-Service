import React, { useState, useEffect } from 'react';
import { ISPProvider } from './context/ISPContext';
import { Sidebar } from './components/Sidebar';
import { Header, ActiveTab } from './components/Header';
import { NocOverview } from './components/NocOverview';
import { MikrotikStudio } from './components/MikrotikStudio';
import { VsolOltStudio } from './components/VsolOltStudio';
import { BillingStudio } from './components/BillingStudio';
import { ComplaintsStudio } from './components/ComplaintsStudio';
import { MobileAppSimulator } from './components/MobileAppSimulator';
import { UserManagementStudio } from './components/UserManagementStudio';
import { ArchitectureStudio } from './components/ArchitectureStudio';
import { SettingsStudio } from './components/SettingsStudio';
import { ProvisionSecretModal } from './components/ProvisionSecretModal';
import { OutageBroadcasterModal } from './components/OutageBroadcasterModal';
import { NewTicketModal } from './components/NewTicketModal';
import { ReceiptModal } from './components/ReceiptModal';
import { CashPaymentModal } from './components/CashPaymentModal';
import { AddMikrotikDeviceModal } from './components/AddMikrotikDeviceModal';
import { Invoice } from './types/isp';
import { SystemRole } from './types/auth';
import { Radio, ShieldCheck, Database, ShieldAlert } from 'lucide-react';

function ISPAppContent() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('noc');
  const [currentRole, setCurrentRole] = useState<SystemRole>('ADMIN');

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans selection:bg-cyan-900 selection:text-cyan-200">
      {/* 1. Off-Canvas Collapsible Sidebar (HIDDEN by default, toggled via Navbar Menu button) */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          setIsSidebarOpen(false);
        }}
        onOpenProvisionModal={() => {
          setIsProvisionOpen(true);
          setIsSidebarOpen(false);
        }}
        onOpenOutageModal={() => {
          setIsOutageOpen(true);
          setIsSidebarOpen(false);
        }}
        onOpenTicketModal={() => {
          setIsTicketOpen(true);
          setIsSidebarOpen(false);
        }}
        currentRole={currentRole}
        onSwitchRole={setCurrentRole}
      />

      {/* 2. Main Flex Viewport (Navbar + Scrollable Body + Footer) */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Top Navbar / Header Bar with Menu Toggle Button */}
        <Header
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onOpenProvisionModal={() => setIsProvisionOpen(true)}
          onOpenOutageModal={() => setIsOutageOpen(true)}
          onOpenTicketModal={() => setIsTicketOpen(true)}
          onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
          onOpenPaymentModal={handleOpenPayment}
          onOpenReceiptModal={handleOpenReceipt}
          currentRole={currentRole}
          onSwitchRole={setCurrentRole}
        />

        {/* RBAC Role-Guard Notice Banner when simulating non-Admin roles */}
        {currentRole !== 'ADMIN' && (
          <div className="bg-amber-950/80 border-b border-amber-800 text-amber-300 text-xs px-4 py-2 font-mono flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                Role-Based Access Simulation: Logged in as <strong>{currentRole}</strong> (
                {currentRole === 'AGENT' ? 'Field Recovery & Complaints' : 'Self-Service Subscriber'}
                ).
              </span>
            </div>
            <button
              onClick={() => setCurrentRole('ADMIN')}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] cursor-pointer"
            >
              Switch to Master Admin
            </button>
          </div>
        )}

        {/* Scrollable Main Content Body */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950">
          <div className="max-w-7xl mx-auto space-y-6">
            {activeTab === 'noc' && (
              <NocOverview
                onNavigateTab={(tab) => setActiveTab(tab)}
                onOpenOutageModal={() => setIsOutageOpen(true)}
                onOpenTicketModal={() => setIsTicketOpen(true)}
              />
            )}

            {activeTab === 'mikrotik' && (
              <MikrotikStudio
                onOpenProvisionModal={() => setIsProvisionOpen(true)}
                onOpenAddRouterModal={() => setIsAddRouterOpen(true)}
              />
            )}

            {activeTab === 'olt' && <VsolOltStudio />}

            {activeTab === 'billing' && (
              <BillingStudio
                onOpenReceiptModal={handleOpenReceipt}
                onOpenPaymentModal={handleOpenPayment}
              />
            )}

            {activeTab === 'complaints' && (
              <ComplaintsStudio
                onOpenTicketModal={() => setIsTicketOpen(true)}
                onOpenOutageModal={() => setIsOutageOpen(true)}
              />
            )}

            {activeTab === 'mobile' && (
              <MobileAppSimulator
                onOpenReceiptModal={handleOpenReceipt}
                onOpenPaymentModal={handleOpenPayment}
              />
            )}

            {activeTab === 'users' && (
              <UserManagementStudio
                currentSimulatedRole={currentRole}
                onSwitchSimulatedRole={setCurrentRole}
              />
            )}

            {activeTab === 'architecture' && <ArchitectureStudio />}

            {activeTab === 'settings' && <SettingsStudio />}
          </div>
        </main>

        {/* Compact Footer Strip */}
        <footer className="border-t border-slate-900 bg-slate-950/90 py-2.5 px-4 sm:px-6 text-[11px] text-slate-500 shrink-0">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 font-mono">
            <div className="flex items-center gap-2">
              <Radio className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-300 font-bold">Youth Net Carrier NOC v4.2</span>
              <span>&bull; RouterOS v7.16 + VSOL OLT Live Telemetry</span>
            </div>

            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-emerald-400">
                <ShieldCheck className="w-3 h-3" /> Carrier SLA Active
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1 text-cyan-400">
                <Database className="w-3 h-3" /> PostgreSQL 16
              </span>
            </div>
          </div>
        </footer>
      </div>

      {/* Global Modals */}
      <ProvisionSecretModal
        isOpen={isProvisionOpen}
        onClose={() => setIsProvisionOpen(false)}
      />

      <OutageBroadcasterModal
        isOpen={isOutageOpen}
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
        invoice={selectedPaymentInvoice}
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
    <ISPProvider>
      <ISPAppContent />
    </ISPProvider>
  );
}
