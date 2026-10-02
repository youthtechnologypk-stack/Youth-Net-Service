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
