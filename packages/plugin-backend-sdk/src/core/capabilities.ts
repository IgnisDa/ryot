import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const CORE_SANDBOX_HOST_CAPABILITIES = [
	"log",
	"span",
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getPluginConfig",
	"getUserPreferences",
	"getUserSettings",
	"claimPersistentValue",
	"getPersistentValue",
] as const;
export const coreSandboxHostCapabilitySchema = Schema.Literals([...CORE_SANDBOX_HOST_CAPABILITIES]);
export type CoreSandboxHostCapability = Schema.Schema.Type<typeof coreSandboxHostCapabilitySchema>;
export const DOMAIN_SANDBOX_HOST_CAPABILITIES = [
	"createEvents",
	"requestEventStreamWork",
	"updateEvents",
	"deleteEvents",
	"getEntitySchemas",
	"listEventSchemas",
	"listIntegrations",
	"executeRyotql",
	"ensureUserEntities",
	"createUserEntity",
	"updateUserEntity",
	"upsertGlobalEntities",
	"getCurrentIntegration",
	"getOAuthAccessToken",
	"invalidateOAuthAccessToken",
	"changeUserRelationships",
	"upsertGlobalRelationships",
] as const;
export const domainSandboxHostCapabilitySchema = Schema.Literals([
	...DOMAIN_SANDBOX_HOST_CAPABILITIES,
]);
export type DomainSandboxHostCapability = Schema.Schema.Type<
	typeof domainSandboxHostCapabilitySchema
>;
export const SYSTEM_CRON_SANDBOX_HOST_CAPABILITIES = [
	"upsertGlobalEntities",
	"upsertGlobalRelationships",
] as const;
export const AUTOMATION_SANDBOX_HOST_CAPABILITIES = ["emitSignal", "sendNotification"] as const;
export type AutomationSandboxHostCapability = (typeof AUTOMATION_SANDBOX_HOST_CAPABILITIES)[number];
export const FILESYSTEM_GRANT_SANDBOX_CAPABILITIES = ["scratch", "artifact-read"] as const;
export type FilesystemGrantSandboxCapability =
	(typeof FILESYSTEM_GRANT_SANDBOX_CAPABILITIES)[number];
export const SANDBOX_HOST_CAPABILITIES = [
	...CORE_SANDBOX_HOST_CAPABILITIES,
	...DOMAIN_SANDBOX_HOST_CAPABILITIES,
	...AUTOMATION_SANDBOX_HOST_CAPABILITIES,
	...FILESYSTEM_GRANT_SANDBOX_CAPABILITIES,
] as const satisfies readonly SandboxHostCapability[];
export const sandboxHostCapabilitySchema = Schema.Literals([...SANDBOX_HOST_CAPABILITIES]);
