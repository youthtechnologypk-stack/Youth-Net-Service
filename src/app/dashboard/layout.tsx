import React, { useState, useEffect } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { Navbar } from '../../components/Navbar';
import { ActiveTab } from '../../components/Header';
import { SystemRole } from '../../types/auth';

interface DashboardLayoutProps {
  children?: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  // 1. Sidebar is HIDDEN by default
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('noc');
  const [currentRole, setCurrentRole] = useState<SystemRole>('ADMIN');

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
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* 1. Off-Canvas Collapsible Sidebar (HIDDEN by default, smooth slide-in with backdrop) */}
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

      {/* 2. Main Viewport Container */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Top Navbar with Hamburger/Close Toggle Button */}
        <Navbar
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenProvisionModal={() => setIsProvisionOpen(true)}
          onOpenOutageModal={() => setIsOutageOpen(true)}
          onOpenTicketModal={() => setIsTicketOpen(true)}
          currentRole={currentRole}
          onSwitchRole={setCurrentRole}
        />

        {/* Scrollable Main Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}
