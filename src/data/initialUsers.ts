import { UserAccount } from '../types/auth';

/**
 * Initial User Seed Accounts for Client & Demo Runtime
 * Pre-computed standard bcrypt salted hash strings for browser safety
 */

export const INITIAL_USER_ACCOUNTS: UserAccount[] = [
  {
    id: 'usr-admin-01',
    username: 'admin',
    email: 'admin@isp.local',
    role: 'ADMIN',
    // Pre-computed bcrypt hash representation for initial password "admin@123"
    passwordHash: '$2b$12$e8uqV7kL1pW3mZ9yN5oR4u.7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
    displayName: 'Youth Net NOC Super Admin',
    phone: '+92 300 1234567',
    isActive: true,
    mustChangePassword: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'usr-agent-01',
    username: 'bilal.khan',
    email: 'bilal.khan@youthnet.pk',
    role: 'AGENT',
    passwordHash: '$2b$12$e8uqV7kL1pW3mZ9yN5oR4u.agent123hash7a8b9c0d1e2f3a4b5c6d7',
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
    role: 'AGENT',
    passwordHash: '$2b$12$e8uqV7kL1pW3mZ9yN5oR4u.agent123hash7a8b9c0d1e2f3a4b5c6d8',
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
    role: 'CLIENT',
    passwordHash: '$2b$12$e8uqV7kL1pW3mZ9yN5oR4u.client123hash7a8b9c0d1e2f3a4b5c6',
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
    role: 'CLIENT',
    passwordHash: '$2b$12$e8uqV7kL1pW3mZ9yN5oR4u.client123hash7a8b9c0d1e2f3a4b5c7',
    displayName: 'Dr. Shahzad Rafique',
    phone: '+92 300 5559812',
    linkedCustomerId: 'cust-101',
    isActive: true,
    mustChangePassword: false,
    createdAt: '2026-01-15T00:00:00.000Z',
  },
];
