import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";

export type SandboxCapabilitySystemKind = "automation" | "script";
export type SandboxCapabilitySubject = "user" | "automation-run" | "system";
export type SandboxCapabilityRequirement = {
	readonly bridge: boolean;
	readonly requiresProvider?: boolean;
	readonly requiresSystemPlugin?: boolean;
	readonly requiresSystemUserBootstrap?: boolean;
	readonly subjects: readonly SandboxCapabilitySubject[];
	readonly systemKinds?: readonly SandboxCapabilitySystemKind[];
};

export const SANDBOX_CAPABILITY_REQUIREMENTS = {
	scratch: { subjects: [], bridge: false },
	"artifact-read": { subjects: [], bridge: false },
	sendNotification: { bridge: true, subjects: ["automation-run"] as const },
	createEvents: { bridge: true, subjects: ["user", "automation-run"] as const },
	log: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	span: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	listIntegrations: { bridge: true, subjects: ["user", "automation-run"] as const },
	listEventSchemas: { bridge: true, subjects: ["user", "automation-run"] as const },
	getEntitySchemas: { bridge: true, subjects: ["user", "automation-run"] as const },
	httpCall: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	getUserPreferences: { bridge: true, subjects: ["user", "automation-run"] as const },
	getCurrentIntegration: { bridge: true, subjects: ["user", "automation-run"] as const },
	changeUserRelationships: { bridge: true, subjects: ["user", "automation-run"] as const },
	getCachedValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	setCachedValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	getPluginConfig: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	getSystemConfig: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	claimPersistentValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	ensureUserEntities: {
		bridge: true,
		subjects: ["user"] as const,
		requiresSystemUserBootstrap: true,
	},
	upsertGlobalRelationships: {
		bridge: true,
		requiresSystemPlugin: true,
		subjects: ["system"] as const,
		systemKinds: ["script"] as const,
	},
	emitSignal: {
		bridge: true,
		requiresSystemPlugin: true,
		systemKinds: ["automation"] as const,
		subjects: ["automation-run", "system"] as const,
	},
	executeRyotql: {
		bridge: true,
		requiresSystemPlugin: true,
		subjects: ["user", "automation-run", "system"],
		systemKinds: ["script", "automation"] as const,
	},
	upsertGlobalEntities: {
		bridge: true,
		requiresProvider: true,
		requiresSystemPlugin: true,
		subjects: ["system"] as const,
		systemKinds: ["script"] as const,
	},
} satisfies Record<SandboxHostCapability, SandboxCapabilityRequirement>;

export const isSandboxCapability = (key: string): key is SandboxHostCapability =>
	Object.hasOwn(SANDBOX_CAPABILITY_REQUIREMENTS, key);

export const sandboxCapabilityRequirement = (
	capability: SandboxHostCapability,
): SandboxCapabilityRequirement => SANDBOX_CAPABILITY_REQUIREMENTS[capability];
