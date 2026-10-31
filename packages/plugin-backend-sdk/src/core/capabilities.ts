import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const SYSTEM_CRON_SANDBOX_HOST_CAPABILITIES = [
	"upsertGlobalEntities",
	"upsertGlobalRelationships",
] as const;
export const sandboxHostCapabilitySchema = Schema.Literals([...SANDBOX_HOST_CAPABILITIES]);
