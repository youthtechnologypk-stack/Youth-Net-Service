import React, { useState, useEffect } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { Navbar } from '../../components/Navbar';
import { ActiveTab } from '../../components/Header';
import { SystemRole, UserAccount } from '../../types/auth';
import { CurrencyProvider } from '../../context/CurrencyContext';
import { getStoredUser, isOriginalAdminSession } from '../../lib/auth';

interface DashboardLayoutProps {
  children?: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [currentUser] = useState<UserAccount | null>(() => getStoredUser());
  const [currentRole, setCurrentRole] = useState<SystemRole>(() => {
    const user = getStoredUser();
    return user?.role || 'ADMIN';
  });

  const isClient = currentRole === 'CLIENT' || currentUser?.role === 'CLIENT';
  const isOriginalAdmin = isOriginalAdminSession();

  // 1. Sidebar is HIDDEN by default (and completely absent for client role)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => (isClient ? 'client_portal' : 'noc'));

  // Modals state triggers
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [isOutageOpen, setIsOutageOpen] = useState(false);
  const [isTicketOpen, setIsTicketOpen] = useState(false);

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

  return (
    <CurrencyProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
        {/* 1. Off-Canvas Collapsible Sidebar (Strictly hidden for Client subscribers) */}
        {!isClient && (
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
            onSwitchRole={isOriginalAdmin ? setCurrentRole : undefined}
            currentUser={currentUser}
          />
        )}

        {/* 2. Main Viewport Container */}
        <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
          {/* Top Navbar with Clean Client View or NOC Controls */}
          <Navbar
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onOpenProvisionModal={() => {
              if (isClient) return;
              setIsProvisionOpen(true);
            }}
            onOpenOutageModal={() => {
              if (isClient) return;
              setIsOutageOpen(true);
            }}
            onOpenTicketModal={() => setIsTicketOpen(true)}
            currentRole={currentRole}
            onSwitchRole={isOriginalAdmin ? setCurrentRole : undefined}
            currentUser={currentUser}
          />

          {/* Scrollable Main Content */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950">
            {children}
          </main>
        </div>
      </div>
    </CurrencyProvider>
  );
}
