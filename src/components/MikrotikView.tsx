import React from 'react';
import { MikrotikStudio } from './MikrotikStudio';
import { ActiveSession } from '../types/isp';

export type PPPoESession = ActiveSession;

export interface MikrotikViewProps {
  onOpenProvisionModal: () => void;
  onOpenAddRouterModal?: () => void;
}

/**
 * MikrotikView Component
 * Renders the primary MikroTik router operations view.
 * All PPPoE active sessions are strictly initialized to empty and bound to live REST data.
 */
export const MikrotikView: React.FC<MikrotikViewProps> = (props) => {
  return <MikrotikStudio {...props} />;
};

export default MikrotikView;
