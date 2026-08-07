/** Supported setup-time surface for the OpenClaw Adapter. */

export { resolveOpenclawBin } from './binary.js';
export {
  CONVOSKETCHPAD_OPERATOR_SCOPES,
  createDeviceBlock,
  storeDeviceAuth,
} from './device-identity.js';
export {
  CONVOSKETCHPAD_GATEWAY_CLIENT_ID,
  CONVOSKETCHPAD_GATEWAY_CLIENT_MODE,
  CONVOSKETCHPAD_GATEWAY_CLIENT_PLATFORM,
  gatewayConnectionMode,
  gatewayRequiresDevicePairing,
} from './gateway-client-identity.js';
