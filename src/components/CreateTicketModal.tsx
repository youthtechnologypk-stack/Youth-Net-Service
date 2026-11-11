import React from 'react';
import { NewTicketModal, CreateTicketModalProps } from './NewTicketModal';

export { NewTicketModal };
export type { CreateTicketModalProps };

export const CreateTicketModal: React.FC<CreateTicketModalProps> = (props) => {
  return <NewTicketModal {...props} />;
};

export default CreateTicketModal;
