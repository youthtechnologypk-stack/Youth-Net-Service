import React, { useState } from 'react';
import {
  X,
  Send,
  Copy,
  Check,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Smartphone,
  Lock,
  User,
  Key,
} from 'lucide-react';
import { UserAccount } from '../types/auth';
import {
  buildStandardWhatsAppCredentialText,
  getPortalUrlForRole,
} from '../services/authUtils';

interface WhatsAppDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserAccount | null;
  plainPassword?: string;
  customMessage?: string;
}

export const WhatsAppDispatchModal: React.FC<WhatsAppDispatchModalProps> = ({
  isOpen,
  onClose,
  user,
  plainPassword = '••••••••',
  customMessage,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !user) return null;

  const targetName = user.displayName || user.fullName;
  const portalUrl = getPortalUrlForRole(user.role);
  const messageText =
    customMessage ||
    buildStandardWhatsAppCredentialText(
      targetName,
      user.username,
      plainPassword,
      portalUrl
    );

  const cleanPhone = (user.phone || '').replace(/[^\d+]/g, '').replace('+', '');
  const whatsAppUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(messageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenWhatsApp = () => {
    window.open(whatsAppUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in font-sans">
      <div className="bg-slate-900 border border-emerald-800/60 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl shadow-emerald-950/40">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 border-b border-emerald-800/40 p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-900/50 border border-emerald-700/60 text-emerald-400 rounded-xl">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Instant WhatsApp Credential Dispatch
              </h3>
              <p className="text-xs text-emerald-300/80 font-mono mt-0.5">
                Ready for 1-Click Message Delivery
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs">
          {/* User Preview Summary Strip */}
          <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center justify-center font-bold font-mono">
                {targetName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <span className="font-bold text-white block text-sm">{targetName}</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  @{user.username} &bull; {user.phone}
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-emerald-950 text-emerald-300 border border-emerald-800">
              {user.role}
            </span>
          </div>

          {/* Generated Message Box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                <span>WhatsApp Message Preview (Exact Format)</span>
              </label>
              <button
                type="button"
                onClick={handleCopy}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1 cursor-pointer transition"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied!' : 'Copy Text'}</span>
              </button>
            </div>

            <div className="relative">
              <pre className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-slate-200 text-xs font-mono whitespace-pre-wrap leading-relaxed select-all">
                {messageText}
              </pre>
            </div>
          </div>

          {/* Key Credentials Card */}
          <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[10px] uppercase">Portal Username</span>
              <span className="text-cyan-400 font-bold text-xs select-all">@{user.username}</span>
            </div>
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[10px] uppercase">Plain Password</span>
              <span className="text-emerald-400 font-bold text-xs select-all">{plainPassword}</span>
            </div>
          </div>

          {/* Notice */}
          <div className="flex items-start gap-2 p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <span>
              Clicking below will launch WhatsApp Web or WhatsApp Desktop targeting{' '}
              <strong className="text-white">{user.phone}</strong> with the pre-filled message.
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition cursor-pointer"
            >
              Done
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium flex items-center gap-1.5 transition cursor-pointer border border-slate-700"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 transition cursor-pointer active:scale-95"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Open in WhatsApp</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-70" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
