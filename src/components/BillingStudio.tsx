import React from 'react';
import { BillingManagement, BillingManagementProps } from './BillingManagement';
import { Invoice } from '../types/isp';

export interface BillingStudioProps extends BillingManagementProps {}

export const BillingStudio: React.FC<BillingStudioProps> = (props) => {
  return <BillingManagement {...props} />;
};

export default BillingStudio;
