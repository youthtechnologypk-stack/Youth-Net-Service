import React from 'react';
import { UserManagementStudio } from './UserManagementStudio';

export interface UserAccountsViewProps {
  onBack?: () => void;
}

/**
 * UserAccountsView provides the full Transworld ISP User & Subscriber Management Directory
 * with integrated click-to-view 360° Subscriber Profiles.
 */
export const UserAccountsView: React.FC<UserAccountsViewProps> = () => {
  return <UserManagementStudio />;
};

export default UserAccountsView;
