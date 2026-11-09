import React from 'react';
import { ClientSubscriberPortal } from './ClientSubscriberPortal';
import { UserAccount } from '../types/auth';
import { Invoice } from '../types/isp';

export interface ClientPortalProps {
  currentUser: UserAccount;
  onOpenReceiptModal: (invoice: Invoice) => void;
  onOpenPaymentModal: (invoice: Invoice) => void;
}

export const ClientPortal: React.FC<ClientPortalProps> = (props) => {
  return <ClientSubscriberPortal {...props} />;
};

export default ClientPortal;
