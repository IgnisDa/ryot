import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const sandboxHostCapabilitySchema = Schema.Literals([...SANDBOX_HOST_CAPABILITIES]);
