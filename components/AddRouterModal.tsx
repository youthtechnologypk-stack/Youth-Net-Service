import React from 'react';
import {
  AddMikrotikDeviceModal,
  AddMikrotikDeviceModalProps,
} from '../src/components/AddMikrotikDeviceModal';

export type AddRouterModalProps = AddMikrotikDeviceModalProps;

/**
 * AddRouterModal component (root components export)
 * Supports:
 * - Netlify-compatible API routing & zero HTML 404 raw errors
 * - RouterOS v7.16+ HTTPS REST API support (Port 443 / 8729)
 * - Graceful fallback to save device profiles even when cloud hosts timeout live probes
 */
export const AddRouterModal: React.FC<AddRouterModalProps> = (props) => {
  return <AddMikrotikDeviceModal {...props} />;
};

export default AddRouterModal;
export { AddMikrotikDeviceModal };
