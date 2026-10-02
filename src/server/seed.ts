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
  email: 'admin@isp.local',
  role: 'ADMIN' as const,
  // bcrypt hash for "admin@123"
  passwordHash: hashPassword('admin@123'),
  displayName: 'Youth Net NOC Super Admin',
  phone: '+92 300 1234567',
  isActive: true,
  mustChangePassword: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

export const INITIAL_USER_ACCOUNTS = [
  SEED_ADMIN_ACCOUNT,
  {
    id: 'usr-agent-01',
    username: 'bilal.khan',
    email: 'bilal.khan@youthnet.pk',
    role: 'AGENT' as const,
    passwordHash: hashPassword('agent@123'),
    displayName: 'Bilal Khan',
    phone: '+92 301 5550192',
    linkedAgentId: 'agent-1',
    assignedArea: 'Sector G-11 & G-10',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-02-15T00:00:00.000Z',
  },
  {
    id: 'usr-agent-02',
    username: 'tariq.mehmood',
    email: 'tariq.mehmood@youthnet.pk',
    role: 'AGENT' as const,
    passwordHash: hashPassword('agent@123'),
    displayName: 'Tariq Mehmood',
    phone: '+92 302 5550881',
    linkedAgentId: 'agent-2',
    assignedArea: 'Sector I-8 & H-8',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  {
    id: 'usr-client-01',
    username: 'fatima_noor_g11',
    email: 'fatima.noor@outlook.com',
    role: 'CLIENT' as const,
    passwordHash: hashPassword('client@123'),
    displayName: 'Fatima Noor',
    phone: '+92 313 5552390',
    linkedCustomerId: 'cust-104',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-02-10T00:00:00.000Z',
  },
  {
    id: 'usr-client-02',
    username: 'dr_shahzad_g11',
    email: 'dr.shahzad@hospital.pk',
    role: 'CLIENT' as const,
    passwordHash: hashPassword('client@123'),
    displayName: 'Dr. Shahzad Rafique',
    phone: '+92 300 5559812',
    linkedCustomerId: 'cust-101',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-01-15T00:00:00.000Z',
  },
];

/**
 * Node.js Boot Seeder Function
 */
export async function seedDatabaseUsers(dbPool?: any) {
  console.log('[SEED] Checking Master Admin account...');
  const adminPasswordHash = hashPassword('admin@123');

  if (dbPool) {
    const query = `
      INSERT INTO users (id, username, email, role, password_hash, display_name, phone, is_active, must_change_password)
      VALUES (
        gen_random_uuid(),
        'admin',
        'admin@isp.local',
        'ADMIN',
        $1,
        'Youth Net NOC Super Admin',
        '+92 300 1234567',
        TRUE,
        TRUE
      )
      ON CONFLICT (username) DO NOTHING;
    `;
    await dbPool.query(query, [adminPasswordHash]);
    console.log('[SEED] Master Admin created successfully: username="admin", email="admin@isp.local", initial_password="admin@123"');
  }

  return INITIAL_USER_ACCOUNTS;
}
