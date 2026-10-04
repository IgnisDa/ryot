export const CORE_SANDBOX_HOST_CAPABILITIES = [
	"log",
	"span",
	"httpCall",
	"getCachedValue",
	"setCachedValue",
	"getPluginConfig",
	"getProAvailability",
	"getUserPreferences",
	"getUserSettings",
	"verifyManagedAssets",
	"claimPersistentValue",
	"getPersistentValue",
] as const;
export type CoreSandboxHostCapability = (typeof CORE_SANDBOX_HOST_CAPABILITIES)[number];

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
	"deleteUserEntity",
	"updateUserEntity",
	"mergeUserEntityData",
	"upsertGlobalEntities",
	"getCurrentIntegration",
	"getOAuthAccessToken",
	"invalidateOAuthAccessToken",
	"changeUserRelationships",
	"upsertGlobalRelationships",
] as const;
export type DomainSandboxHostCapability = (typeof DOMAIN_SANDBOX_HOST_CAPABILITIES)[number];

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
] as const;

export type SandboxHostCapability = (typeof SANDBOX_HOST_CAPABILITIES)[number];

export const isSandboxHostCapability = (key: string): key is SandboxHostCapability =>
	SANDBOX_HOST_CAPABILITIES.some((capability) => capability === key);

export const POLICY_SAFE_SANDBOX_CAPABILITIES = [
	"log",
	"span",
	"getCachedValue",
	"getPluginConfig",
	"getUserPreferences",
	"getUserSettings",
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
