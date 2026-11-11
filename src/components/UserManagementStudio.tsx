import React from 'react';
import { UserAccountsView, UserAccountsViewProps } from './UserAccountsView';

export interface UserManagementStudioProps extends UserAccountsViewProps {}

/**
 * UserManagementStudio renders the primary User & Subscriber Access Management hub
 * strictly synchronized with Supabase portal_users and the new UsersTable.
 */
export const UserManagementStudio: React.FC<UserManagementStudioProps> = (props) => {
  return <UserAccountsView {...props} />;
};

export default UserManagementStudio;
