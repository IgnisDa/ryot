export { JsonValue as jsonValueSchema } from "../../schema/json";
export type { JsonPrimitive, JsonValue } from "../../schema/json";

export const SANDBOX_HOST_CAPABILITIES = [
	"log",
	"span",
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getPluginConfig",
	"getSystemConfig",
	"getUserPreferences",
	"claimPersistentValue",
	"createEvents",
	"getEntitySchemas",
	"listEventSchemas",
	"listIntegrations",
	"executeRyotql",
	"ensureUserEntities",
	"upsertGlobalEntities",
	"getCurrentIntegration",
	"changeUserRelationships",
	"upsertGlobalRelationships",
	"emitSignal",
	"sendNotification",
	"scratch",
	"artifact-read",
] as const;

export type SandboxHostCapability = (typeof SANDBOX_HOST_CAPABILITIES)[number];
