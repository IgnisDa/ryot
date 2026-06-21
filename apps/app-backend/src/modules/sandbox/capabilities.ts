export const SANDBOX_HOST_CAPABILITIES = [
	"httpCall",
	"getEntity",
	"listEvents",
	"createEvents",
	"getCachedValue",
	"getIntegration",
	"setCachedValue",
	"getEntitySchema",
	"listEventSchemas",
	"listIntegrations",
	"claimCachedValue",
	"getAppConfigValue",
	"getUserPreferences",
	"executeQueryEngine",
] as const;

const sandboxHostCapabilities = new Set<string>(SANDBOX_HOST_CAPABILITIES);

export const isSandboxHostCapability = (value: string) => sandboxHostCapabilities.has(value);
