import React from 'react';
import { ComplaintsStudio } from './ComplaintsStudio';

export interface ComplaintsViewProps {
  onOpenTicketModal: () => void;
  onOpenOutageModal: () => void;
}

export const ComplaintsView: React.FC<ComplaintsViewProps> = (props) => {
  return <ComplaintsStudio {...props} />;
};

export default ComplaintsView;
