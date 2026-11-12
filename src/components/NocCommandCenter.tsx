import React from 'react';
import { NocOverview } from './NocOverview';
import { ActiveTab } from './Header';

export interface NocCommandCenterProps {
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenOutageModal: () => void;
  onOpenTicketModal: () => void;
  onOpenAddRouterModal?: () => void;
}

export const NocCommandCenter: React.FC<NocCommandCenterProps> = (props) => {
  return <NocOverview {...props} />;
};

export default NocCommandCenter;
