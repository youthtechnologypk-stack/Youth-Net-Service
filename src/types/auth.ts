// Authentication & RBAC (Role-Based Access Control) Types

export type SystemRole = 'ADMIN' | 'MANAGER' | 'AGENT' | 'CLIENT';

export interface UserAccount {
  id: string;
  username: string; // e.g. "admin", "manager", "agent", "client"
  fullName: string;
  displayName?: string;
  email?: string;
  role: SystemRole;
  passwordHash?: string; // bcrypt hash ($2b$12$...)
  password?: string; // Stored plain/temporary credential for portal access
  phone: string;
  isActive: boolean;
  area?: string; // Normalized area/coverage sector
  cashInHand?: number; // Normalized field cash in hand
  mustChangePassword?: boolean;
  linkedAgentId?: string; // Foreign key linking to FieldAgent
  linkedCustomerId?: string; // Foreign key linking to Customer
  assignedArea?: string; // Compatibility alias
  department?: string; // For Managers: NOC, Operations, Accounts, Field SLA
  cashLimit?: number; // For Agents: Cash Collection Limit in PKR
  balance?: number; // Cash in hand or user wallet balance
  base_salary?: number; // Base monthly salary compensation
  advance_balance?: number; // Outstanding advance salary balance
  grantClientPortal?: boolean; // For Clients: Grant Self-Service Portal Access
  sendWhatsAppNotice?: boolean;
  package_speed?: string; // Subscribed speed tier (e.g. "20 Mbps")
  monthly_fee?: number; // Monthly fee in PKR
  package_volume_gb?: number; // FUP data limit in GB (e.g. 1500)
  cnic?: string;
  address?: string;
  permissions?: Record<string, boolean>; // Granular feature override flags
  createdAt: string;
  lastLoginAt?: string;
}

export interface JwtTokenPayload {
  userId: string;
  username: string;
  email: string;
  role: SystemRole;
  linkedAgentId?: string;
  linkedCustomerId?: string;
  iat: number;
  exp: number;
}

export interface AuthSession {
  user: UserAccount;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface ResetCredentialPayload {
  userId: string;
  newPassword?: string;
  autoGeneratePassword?: boolean;
  mustChangePassword?: boolean;
  sendWhatsAppNotice?: boolean;
}

export interface CredentialShareDetails {
  username: string;
  temporaryPassword: string;
  portalUrl: string;
  role: SystemRole;
  phone: string;
  displayName: string;
  whatsAppPayloadText: string;
}
