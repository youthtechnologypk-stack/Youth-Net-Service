import React from 'react';
import { ShieldAlert, ArrowLeft, Lock, ShieldCheck } from 'lucide-react';
import { SystemRole } from '../types/auth';

interface AccessDeniedViewProps {
  currentRole: SystemRole;
  attemptedResource: string;
  onReturnToAllowed: () => void;
}

export const AccessDeniedView: React.FC<AccessDeniedViewProps> = ({
  currentRole,
  attemptedResource,
  onReturnToAllowed,
}) => {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-rose-950/40 border border-rose-800/80 rounded-2xl p-8 max-w-lg w-full space-y-5 shadow-2xl backdrop-blur-md">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-900/60 border border-rose-700 text-rose-300 flex items-center justify-center shadow-lg shadow-rose-950/50">
          <ShieldAlert className="w-8 h-8 text-rose-400" />
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-950 border border-rose-800 text-rose-300 font-mono text-[11px] font-bold">
            <Lock className="w-3 h-3" />
            <span>HTTP 403 &bull; ACCESS DENIED</span>
          </div>
          <h2 className="text-xl font-bold text-white">Privilege Escalation Blocked</h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            Your current account role <strong className="text-amber-400 font-mono uppercase">[{currentRole}]</strong> is not authorized to access <code className="bg-slate-900 px-1.5 py-0.5 rounded text-rose-300 border border-rose-900">{attemptedResource}</code>.
          </p>
        </div>

        <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-left text-xs font-mono space-y-1.5 text-slate-400">
          <div className="flex justify-between">
            <span>Logged-in Role:</span>
            <span className="text-cyan-400 font-bold">{currentRole}</span>
          </div>
          <div className="flex justify-between">
            <span>Required Authorization:</span>
            <span className="text-rose-400 font-bold">MASTER ADMIN (RBAC Tier 1)</span>
          </div>
          <div className="flex justify-between">
            <span>Action Taken:</span>
            <span className="text-amber-400">Route Intercepted &amp; Logged</span>
          </div>
        </div>

        <div className="pt-2">
          <button
            onClick={onReturnToAllowed}
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-cyan-600/20"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to My Authorized Dashboard</span>
          </button>
        </div>
      </div>
    </div>
  );
};
