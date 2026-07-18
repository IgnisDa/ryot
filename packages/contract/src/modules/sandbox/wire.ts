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

export const POLICY_SAFE_SANDBOX_CAPABILITIES = [
	"log",
	"span",
	"getCachedValue",
	"getPluginConfig",
	"getSystemConfig",
	"getUserPreferences",
	"getEntitySchemas",
	"listEventSchemas",
	"listIntegrations",
	"executeRyotql",
	"getCurrentIntegration",
] as const satisfies readonly SandboxHostCapability[];

export const SANDBOX_FAILURE_KINDS = [
	"timeout",
	"infrastructure",
	"resource-unavailable",
	"invalid-input",
	"invalid-output",
	"missing-artifact",
	"external-uncertain",
	"script-failure",
] as const;

export type SandboxFailureKind = (typeof SANDBOX_FAILURE_KINDS)[number];
