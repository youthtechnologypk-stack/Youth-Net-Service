import React from 'react';
import {
  AddMikrotikDeviceModal,
  AddMikrotikDeviceModalProps,
} from './AddMikrotikDeviceModal';

export type AddRouterModalProps = AddMikrotikDeviceModalProps;

/**
 * AddRouterModal component (alias for AddMikrotikDeviceModal)
 * Full support for RouterOS v7.16+ HTTPS REST API (Port 443 / 8729),
 * Netlify serverless deployment resilience, and graceful error handling.
 */
export const AddRouterModal: React.FC<AddRouterModalProps> = (props) => {
  return <AddMikrotikDeviceModal {...props} />;
};

export default AddRouterModal;
export { AddMikrotikDeviceModal };
