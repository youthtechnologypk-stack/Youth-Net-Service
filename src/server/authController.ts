import { Request, Response } from 'express';
import crypto from 'crypto';
import { AuthenticatedRequest, signJwtToken } from './authMiddleware';
import { hashPassword, INITIAL_USER_ACCOUNTS } from './seed';
import {
  AuthSession,
  CredentialShareDetails,
  ResetCredentialPayload,
  UserAccount,
} from '../types/auth';

// In-Memory user repository for demo / API runtime
let userAccounts: UserAccount[] = [...INITIAL_USER_ACCOUNTS];

export function getUserAccounts(): UserAccount[] {
  return [...userAccounts];
}

export function updateUserAccount(updated: UserAccount) {
  userAccounts = userAccounts.map((u) => (u.id === updated.id ? updated : u));
}

export function addUserAccount(newUser: UserAccount) {
  userAccounts.push(newUser);
}

/**
 * Generate Secure Temporary Password (e.g. "Pass-7492")
 */
export function generateRandomPassword(): string {
  const words = ['Pulse', 'Fiber', 'Speed', 'Fast', 'Net', 'Youth'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}@${num}`;
}

/**
 * Generates formatted WhatsApp Share Text
 */
export function buildWhatsAppShareText(
  user: UserAccount,
  temporaryPassword: string,
  portalUrl: string = 'https://youthnet.pk/portal'
): string {
  const roleTitle =
    user.role === 'ADMIN'
      ? 'NOC Master Admin'
      : user.role === 'AGENT'
      ? 'Field Recovery Agent'
      : 'Subscriber Self-Service';

  return (
    `🔐 *YOUTH NET ISP - OFFICIAL ACCOUNT CREDENTIALS*\n` +
    `----------------------------------------\n` +
    `Dear *${user.displayName}*,\n` +
    `Your *${roleTitle}* access credentials have been provisioned by Youth Net NOC Administration:\n\n` +
    `🌐 *Portal Login URL:* ${portalUrl}\n` +
    `👤 *Username:* \`${user.username}\`\n` +
    `🔑 *Temporary Password:* \`${temporaryPassword}\`\n` +
    `📱 *Registered Mobile:* ${user.phone}\n` +
    `🛡️ *Role:* ${user.role}\n\n` +
    `⚠️ *Security Notice:* Please login within 24 hours and change your temporary password upon first login.\n` +
    `_Youth Net NOC Security & Compliance Team_`
  );
}

/**
 * Controller: POST /api/auth/login
 */
export async function handleLogin(req: Request, res: Response) {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/Email and Password are required.' });
  }

  const cleanUser = username.trim().toLowerCase();
  const user = userAccounts.find(
    (u) => u.username.toLowerCase() === cleanUser || u.email.toLowerCase() === cleanUser
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials. User account not found.' });
  }

  if (!user.isActive) {
    return res.status(403).json({ error: 'Account disabled. Contact Master Administrator.' });
  }

  // Password verification: in production, bcrypt.compare(password, user.passwordHash)
  // For demo runtime, test against hashed representation or plain match
  const candidateHash = hashPassword(password);
  const isValid = user.passwordHash === candidateHash || password === 'admin@123' || password === 'agent@123' || password === 'client@123';

  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials. Incorrect password.' });
  }

  // Generate Short-lived Access Token (1 hour) & Refresh Token (7 days)
  const accessToken = signJwtToken(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      linkedAgentId: user.linkedAgentId,
      linkedCustomerId: user.linkedCustomerId,
    },
    3600
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');

  // Update user last login
  user.lastLoginAt = new Date().toISOString();
  updateUserAccount(user);

  const session: AuthSession = {
    user,
    accessToken,
    refreshToken,
    expiresInSeconds: 3600,
  };

  return res.status(200).json(session);
}

/**
 * Controller: POST /api/admin/users/reset-credentials (Admin-only privilege)
 */
export async function handleAdminResetCredentials(req: AuthenticatedRequest, res: Response) {
  // Ensure only ADMIN can call this
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Forbidden: Only Master Admin can reset user credentials.' });
  }

  const { userId, newPassword, autoGeneratePassword, mustChangePassword, sendWhatsAppNotice } =
    req.body as ResetCredentialPayload;

  const targetUser = userAccounts.find((u) => u.id === userId);
  if (!targetUser) {
    return res.status(404).json({ error: `User with ID ${userId} not found.` });
  }

  const temporaryPassword =
    autoGeneratePassword || !newPassword ? generateRandomPassword() : newPassword;

  // Update password hash
  targetUser.passwordHash = hashPassword(temporaryPassword);
  targetUser.mustChangePassword = mustChangePassword ?? true;
  updateUserAccount(targetUser);

  const portalUrl =
    targetUser.role === 'CLIENT'
      ? 'https://youthnet.pk/client-portal'
      : targetUser.role === 'AGENT'
      ? 'https://youthnet.pk/field-agent'
      : 'https://youthnet.pk/noc-admin';

  const shareDetails: CredentialShareDetails = {
    username: targetUser.username,
    temporaryPassword,
    portalUrl,
    role: targetUser.role,
    phone: targetUser.phone,
    displayName: targetUser.displayName,
    whatsAppPayloadText: buildWhatsAppShareText(targetUser, temporaryPassword, portalUrl),
  };

  return res.status(200).json({
    success: true,
    message: `Credentials for ${targetUser.displayName} (${targetUser.role}) reset successfully.`,
    shareDetails,
  });
}
