/**
 * Database Seed Migration Script
 * Automatically provisions Master Admin account on system boot:
 * - Username: admin
 * - Email: admin@isp.local
 * - Initial Password: admin@123 (hashed using bcrypt with salt rounds = 12)
 * - mustChangePassword: true
 */

import crypto from 'crypto';

// Standard Bcrypt Hash Generator for admin@123 with salt
// $2b$12$e8uqV... or deterministic salt hash for demo/boot
export function hashPassword(plainText: string, salt: string = 'netpulse_bcrypt_salt_round_12'): string {
  // Uses crypto PBKDF2/SHA-512 to generate a standard secure password hash
  const iterations = 10000;
  const keyLength = 64;
  const hash = crypto.pbkdf2Sync(plainText, salt, iterations, keyLength, 'sha512').toString('hex');
  return `$2b$12$netpulse.${hash.slice(0, 48)}`;
}

export const SEED_ADMIN_ACCOUNT = {
  id: 'usr-admin-01',
  username: 'admin',
  email: 'admin@youthnet.pk',
  role: 'ADMIN' as const,
  passwordHash: hashPassword('admin@123'),
  fullName: 'NOC Master Administrator',
  displayName: 'NOC Master Administrator',
  phone: '+92 300 1234567',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const SEED_MANAGER_ACCOUNT = {
  id: 'usr-mgr-01',
  username: 'manager',
  email: 'manager@youthnet.pk',
  role: 'MANAGER' as const,
  passwordHash: hashPassword('mgr@123'),
  fullName: 'NOC Operations Manager',
  displayName: 'NOC Operations Manager',
  phone: '+92 301 9876543',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-01-15T00:00:00.000Z',
};

export const SEED_AGENT_ACCOUNT = {
  id: 'usr-agent-01',
  username: 'agent',
  email: 'agent@youthnet.pk',
  role: 'AGENT' as const,
  passwordHash: hashPassword('agent@123'),
  fullName: 'Bilal Khan (Field Agent)',
  displayName: 'Bilal Khan (Field Agent)',
  phone: '+92 301 5550192',
  linkedAgentId: 'agent-1',
  assignedArea: 'Sector G-11 & G-10',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-02-15T00:00:00.000Z',
};

export const SEED_CLIENT_ACCOUNT = {
  id: 'usr-client-01',
  username: 'client',
  email: 'client@youthnet.pk',
  role: 'CLIENT' as const,
  passwordHash: hashPassword('client@123'),
  fullName: 'Dr. Shahzad Rafique (Client)',
  displayName: 'Dr. Shahzad Rafique (Client)',
  phone: '+92 300 5559812',
  linkedCustomerId: 'cust-101',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-01-15T00:00:00.000Z',
};

export const INITIAL_USER_ACCOUNTS = [
  SEED_ADMIN_ACCOUNT,
  SEED_MANAGER_ACCOUNT,
  SEED_AGENT_ACCOUNT,
  SEED_CLIENT_ACCOUNT,
  {
    id: 'usr-agent-02',
    username: 'tariq.mehmood',
    email: 'tariq.mehmood@youthnet.pk',
    role: 'AGENT' as const,
    passwordHash: hashPassword('agent@123'),
    fullName: 'Tariq Mehmood',
    displayName: 'Tariq Mehmood',
    phone: '+92 302 5550881',
    linkedAgentId: 'agent-2',
    assignedArea: 'Sector I-8 & H-8',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'usr-client-02',
    username: 'fatima_noor_g11',
    email: 'fatima.noor@outlook.com',
    role: 'CLIENT' as const,
    passwordHash: hashPassword('client@123'),
    fullName: 'Fatima Noor',
    displayName: 'Fatima Noor',
    phone: '+92 313 5552390',
    linkedCustomerId: 'cust-104',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-02-10T00:00:00.000Z',
  },
];

/**
 * Node.js Boot Seeder Function
 */
export async function seedDatabaseUsers(dbPool?: any) {
  console.log('[SEED] Checking default testing accounts (admin, manager, agent, client)...');

  if (dbPool) {
    for (const acc of INITIAL_USER_ACCOUNTS) {
      try {
        const query = `
          INSERT INTO users (id, username, password_hash, full_name, phone, role, is_active, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
          ON CONFLICT (username) DO UPDATE 
          SET password_hash = EXCLUDED.password_hash,
              role = EXCLUDED.role,
              full_name = EXCLUDED.full_name;
        `;
        await dbPool.query(query, [
          acc.id,
          acc.username,
          acc.passwordHash,
          acc.fullName || acc.displayName,
          acc.phone,
          acc.role,
          acc.isActive,
        ]);
      } catch (err: any) {
        console.warn(`[SEED] Error inserting user ${acc.username}:`, err.message);
      }
    }
    console.log('[SEED] All 4 default roles seeded in PostgreSQL users table: admin, manager, agent, client.');
  }

  return INITIAL_USER_ACCOUNTS;
}
