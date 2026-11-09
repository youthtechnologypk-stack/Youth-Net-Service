import React from 'react';
import { ManagerOperationsDashboard } from './ManagerOperationsDashboard';
import { Customer } from '../types/isp';
import { UserAccount } from '../types/auth';

export interface ManagerPortalProps {
  onOpenTicketModal: () => void;
  onOpenOutageModal: () => void;
  onSelectCustomer?: (customer: Customer) => void;
  currentUser?: UserAccount;
}

export const ManagerPortal: React.FC<ManagerPortalProps> = (props) => {
  return <ManagerOperationsDashboard {...props} />;
};

export default ManagerPortal;
