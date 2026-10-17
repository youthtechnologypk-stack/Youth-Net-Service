import { UserAccount } from '../types/auth';

/**
 * Client-Safe Auth Utilities (Browser & Mobile compatible)
 * Zero dependency on Node.js 'crypto' module
 */

export function generateRandomPassword(): string {
  const words = ['Pulse', 'Fiber', 'Speed', 'Fast', 'Net', 'Youth', 'Turbo', 'Carrier'];
  const word = words[Math.floor(Math.random() * words.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}@${num}`;
}

export function getPortalUrlForRole(role: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://youthnet.pk';
  switch (role) {
    case 'ADMIN':
      return `${origin}/dashboard/admin`;
    case 'MANAGER':
      return `${origin}/dashboard/operations`;
    case 'AGENT':
      return `${origin}/agent/portal`;
    case 'CLIENT':
      return `${origin}/client/portal`;
    default:
      return `${origin}/login`;
  }
}

/**
 * Exact specification format for WhatsApp credential dispatch:
 * "Hello [Name], your Youth Net Portal access has been created.
 * Login URL: [Portal Link]
 * Username: [username]
 * Password: [password]
 * Please keep your login credentials secure."
 */
export function buildStandardWhatsAppCredentialText(
  name: string,
  username: string,
  password: string,
  portalUrl?: string
): string {
  const link = portalUrl || (typeof window !== 'undefined' ? `${window.location.origin}/login` : 'https://youthnet.pk/login');
  return `Hello ${name},\n\nYour Youth Net Portal access has been created.\nLogin URL: ${link}\nUsername: ${username}\nPassword: ${password}\n\nPlease keep your login credentials secure.`;
}

export function buildWhatsAppShareText(
  user: UserAccount,
  temporaryPassword: string,
  portalUrl?: string
): string {
  const url = portalUrl || getPortalUrlForRole(user.role);
  const name = user.displayName || user.fullName;
  return buildStandardWhatsAppCredentialText(name, user.username, temporaryPassword, url);
}
