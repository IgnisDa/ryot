import {
	POLICY_SAFE_SANDBOX_CAPABILITIES,
	type SandboxHostCapability,
} from "@ryot-app/contract/modules/scripts/wire";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { SandboxHostImplementationMap as SdkSandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxHostFailure, type SandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import type { ScriptExecutionPrincipal } from "./principal";

export type SandboxCapabilitySystemKind = "automation" | "script";
export type SandboxCapabilitySubject = "user" | "automation-run" | "system";
export type SandboxCapabilityRequirement = {
	readonly bridge: boolean;
	readonly requiresProvider?: boolean;
	readonly requiresSystemPlugin?: boolean;
	readonly requiresUserBootstrap?: boolean;
	readonly subjects: readonly SandboxCapabilitySubject[];
	readonly systemKinds?: readonly SandboxCapabilitySystemKind[];
};

export const SANDBOX_CAPABILITY_REQUIREMENTS = {
	scratch: { subjects: [], bridge: false },
	"artifact-read": { subjects: [], bridge: false },
	createUserEntity: { bridge: true, subjects: ["user"] as const },
	getOAuthAccessToken: { bridge: true, subjects: ["user"] as const },
	invalidateOAuthAccessToken: { bridge: true, subjects: ["user"] as const },
	sendNotification: { bridge: true, subjects: ["automation-run"] as const },
	createEvents: { bridge: true, subjects: ["user", "automation-run"] as const },
	updateEvents: { bridge: true, subjects: ["user", "automation-run"] as const },
	deleteEvents: { bridge: true, subjects: ["user", "automation-run"] as const },
	log: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	span: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	getUserSettings: { bridge: true, subjects: ["user", "automation-run"] as const },
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
	getPersistentValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	ensureUserEntities: { bridge: true, subjects: ["user"] as const, requiresUserBootstrap: true },
	claimPersistentValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	requestEventStreamWork: {
		bridge: true,
		requiresSystemPlugin: true,
		subjects: ["user", "automation-run"],
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

const sandboxCapabilityRequirement = (
	capability: SandboxHostCapability,
): SandboxCapabilityRequirement => SANDBOX_CAPABILITY_REQUIREMENTS[capability];

export type ScriptRunInput = Omit<SandboxRunInput, "principal"> & {
	readonly principal: ScriptExecutionPrincipal;
};

export type ScriptHostImplementationMap = SdkSandboxHostImplementationMap<ScriptRunInput>;

export type AdditionalScriptHostImplementationMap = Omit<
	ScriptHostImplementationMap,
	| "log"
	| "span"
	| "httpCall"
	| "emitSignal"
	| "setCachedValue"
	| "getCachedValue"
	| "sendNotification"
	| "claimPersistentValue"
	| "getPersistentValue"
>;

export type UserSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<ScriptExecutionPrincipal["subject"], { readonly type: "user" }>
			| (Extract<ScriptExecutionPrincipal["subject"], { readonly type: "automation-run" }> & {
					readonly executionUserId: UserId;
			  });
	};
};

type DirectUserSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<ScriptExecutionPrincipal["subject"], { readonly type: "user" }>;
	};
};

type SystemSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<ScriptExecutionPrincipal["subject"], { readonly type: "system" }>
			| (Extract<ScriptExecutionPrincipal["subject"], { readonly type: "automation-run" }> & {
					readonly executionUserId: null;
			  });
	};
};

type SystemProviderSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> =
	SystemSandboxRunInput<Input> & {
		readonly principal: Input["principal"] & {
			readonly providerId: NonNullable<ScriptExecutionPrincipal["providerId"]>;
		};
	};

type AutomationRunSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<
			ScriptExecutionPrincipal["subject"],
			{ readonly type: "automation-run" }
		>;
	};
};

type CapabilitySubject<Capability extends SandboxHostCapability> =
	(typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability]["subjects"][number];

type SandboxRunInputForSubject<Input extends ScriptRunInput, Subject> = Subject extends "user"
	? DirectUserSandboxRunInput<Input>
	: Subject extends "automation-run"
		? AutomationRunSandboxRunInput<Input>
		: Subject extends "system"
			? SystemSandboxRunInput<Input>
			: never;

type SandboxRunInputForCapability<
	Capability extends SandboxHostCapability,
	Input extends ScriptRunInput = ScriptRunInput,
> = (typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability] extends { readonly requiresProvider: true }
	? SystemProviderSandboxRunInput<Input>
	: "system" extends CapabilitySubject<Capability>
		? SandboxRunInputForSubject<Input, CapabilitySubject<Capability>>
		: SandboxRunInputForSubject<Input, CapabilitySubject<Capability>> & UserSandboxRunInput<Input>;

const sandboxCapabilityError = (
	input: Pick<ScriptRunInput, "principal">,
	capability: SandboxHostCapability,
) => {
	const requirement = sandboxCapabilityRequirement(capability);
	const subject = input.principal.subject;
	if (!input.principal.metadata.capabilities?.includes(capability)) {
		return `${capability} is not declared by this script`;
	}
	if (
		subject.type === "automation-run" &&
		subject.stage === "before" &&
		!POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability)
	) {
		return `${capability} is not available to before-stage automation runs`;
	}
	const system =
		subject.type === "system" ||
		(subject.type === "automation-run" && subject.executionUserId === null);
	if (system) {
		if (!requirement.subjects.includes("system")) {
			if (capability === "sendNotification") {
				return `${capability} is available only to user automation runs`;
			}
			return `${capability} is not available for system executions`;
		}
		if (
			requirement.systemKinds &&
			!requirement.systemKinds.some((kind) => kind === input.principal.metadata.kind)
		) {
			return `${capability} is not available to this system execution`;
		}
	} else if (!requirement.subjects.includes(input.principal.subject.type)) {
		if (requirement.subjects.length === 1 && requirement.subjects[0] === "automation-run") {
			return `${capability} is available only to user automation runs`;
		}
		if (requirement.subjects.length === 1 && requirement.subjects[0] === "user") {
			return `${capability} is available only to user executions`;
		}
		return `${capability} is not available to this execution`;
	}
	if (requirement.requiresProvider && input.principal.providerId === null) {
		return `${capability} is available only to provider-associated scripts`;
	}
	if (
		system &&
		requirement.requiresSystemPlugin &&
		input.principal.pluginRevision?.scope !== "system"
	) {
		return `${capability} system access requires a pinned system plugin script`;
	}
	if (
		requirement.requiresUserBootstrap &&
		!input.principal.pluginRevision?.userBootstrapScriptSlugs.includes(input.principal.scriptSlug)
	) {
		return `${capability} is available only to pinned user bootstrap scripts`;
	}
	return undefined;
};

const isSandboxCapabilityInput = <
	Capability extends SandboxHostCapability,
	Input extends ScriptRunInput,
>(
	input: Input,
	capability: Capability,
): input is SandboxRunInputForCapability<Capability, Input> =>
	sandboxCapabilityError(input, capability) === undefined;

export const isSandboxCapabilityAllowed = (
	input: Pick<ScriptRunInput, "principal">,
	capability: SandboxHostCapability,
) => sandboxCapabilityError(input, capability) === undefined;

export const requireSandboxCapabilityInput = <
	Capability extends SandboxHostCapability,
	Input extends ScriptRunInput,
>(
	input: Input,
	capability: Capability,
): Effect.Effect<SandboxRunInputForCapability<Capability, Input>, SandboxHostError> => {
	if (!isSandboxCapabilityInput(input, capability)) {
		return sandboxHostFailure(
			sandboxCapabilityError(input, capability) ??
				`${capability} is not available to this execution`,
			{ operation: capability, code: "unavailable-operation" },
		);
	}
	return Effect.succeed(input);
};
