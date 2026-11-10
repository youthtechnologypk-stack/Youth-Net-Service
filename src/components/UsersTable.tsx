import React from 'react';
import { UserManagementStudio } from './UserManagementStudio';

export interface UsersTableProps {
  onSelectSubscriber?: (username: string) => void;
}

/**
 * UsersTable component re-exporting the UserManagementStudio directory
 * with full Transworld 360° Profile navigation and MikroTik/Supabase bindings.
 */
export const UsersTable: React.FC<UsersTableProps> = () => {
  return <UserManagementStudio />;
};

export default UsersTable;
