import React from 'react';
import { GenerateInvoiceModal, GenerateInvoiceModalProps } from './GenerateInvoiceModal';
import { Invoice } from '../types/isp';

export interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCustomerId?: string;
  defaultBillingMonth?: string;
  onSuccess?: (invoice: Invoice) => void;
}

export const CreateInvoiceModal: React.FC<CreateInvoiceModalProps> = ({
  isOpen,
  onClose,
  defaultCustomerId,
  onSuccess,
}) => {
  return (
    <GenerateInvoiceModal
      isOpen={isOpen}
      onClose={onClose}
      defaultSubscriberUsername={defaultCustomerId}
      onSuccess={onSuccess}
    />
  );
};

export default CreateInvoiceModal;
