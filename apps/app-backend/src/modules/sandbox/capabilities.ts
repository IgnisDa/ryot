import { CORE_SANDBOX_HOST_CAPABILITIES } from "@ryot/sandbox-sdk";

export const SANDBOX_HOST_CAPABILITIES = [
	...CORE_SANDBOX_HOST_CAPABILITIES,
	"getEntity",
	"listEvents",
	"createEvents",
	"getIntegration",
	"getEntitySchema",
	"listEventSchemas",
	"listIntegrations",
	"executeQueryEngine",
] as const;
