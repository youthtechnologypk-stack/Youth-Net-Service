// Authentication & RBAC (Role-Based Access Control) Types

export type SystemRole = 'ADMIN' | 'AGENT' | 'CLIENT';

export interface UserAccount {
  id: string;
  username: string; // e.g. "admin", "bilal.khan", "fatima.noor"
  email: string;
  role: SystemRole;
  passwordHash: string; // bcrypt hash ($2b$12$...)
  isActive: boolean;
  mustChangePassword: boolean;
  linkedAgentId?: string; // Foreign key linking to FieldAgent
  linkedCustomerId?: string; // Foreign key linking to Customer
  displayName: string;
  phone: string;
  assignedArea?: string;
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
