import {
	POLICY_SAFE_SANDBOX_CAPABILITIES,
	type SandboxHostCapability,
} from "@ryot-app/contract/modules/scripts/wire";
import type { UserId } from "@ryot-app/contract/schema/brands";
import type { SandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxHostFailure, type SandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import { Effect } from "effect";

import type { ScriptExecutionPrincipal } from "./principal";

type SandboxCapabilitySystemKind = "script" | "automation";
type SandboxCapabilitySubject = "user" | "agent" | "system" | "projection" | "automation-run";
type SandboxCapabilityRequirement = {
	readonly bridge: boolean;
	readonly requiresSystemPlugin?: boolean;
	readonly subjects: readonly SandboxCapabilitySubject[];
	readonly systemKinds?: readonly SandboxCapabilitySystemKind[];
};

const SANDBOX_CAPABILITY_REQUIREMENTS = {
	scratch: { subjects: [], bridge: false },
	"artifact-read": { subjects: [], bridge: false },
	invokeCapability: { bridge: true, subjects: ["agent"] as const },
	getOAuthAccessToken: { bridge: true, subjects: ["user"] as const },
	invalidateOAuthAccessToken: { bridge: true, subjects: ["user"] as const },
	getEntitlements: { bridge: true, subjects: ["user", "automation-run"] as const },
	httpCall: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	verifyManagedAssets: { bridge: true, subjects: ["user", "automation-run"] as const },
	setCachedValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	getPersistentValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	getUserSettings: { bridge: true, subjects: ["user", "automation-run", "projection"] as const },
	claimPersistentValue: { bridge: true, subjects: ["user", "automation-run", "system"] as const },
	listIntegrations: { bridge: true, subjects: ["user", "automation-run", "projection"] as const },
	getUserPreferences: { bridge: true, subjects: ["user", "automation-run", "projection"] as const },
	getCurrentIntegration: {
		bridge: true,
		subjects: ["user", "automation-run", "projection"] as const,
	},
	log: {
		bridge: true,
		subjects: ["user", "automation-run", "system", "projection", "agent"] as const,
	},
	span: {
		bridge: true,
		subjects: ["user", "automation-run", "system", "projection", "agent"] as const,
	},
	getCachedValue: {
		bridge: true,
		subjects: ["user", "automation-run", "system", "projection"] as const,
	},
	getPluginConfig: {
		bridge: true,
		subjects: ["user", "automation-run", "system", "projection"] as const,
	},
	executeRyotql: {
		bridge: true,
		requiresSystemPlugin: true,
		systemKinds: ["script", "automation"] as const,
		subjects: ["user", "automation-run", "system", "projection"],
	},
} satisfies Record<SandboxHostCapability, SandboxCapabilityRequirement>;

const sandboxCapabilityRequirement = (
	capability: SandboxHostCapability,
): SandboxCapabilityRequirement => SANDBOX_CAPABILITY_REQUIREMENTS[capability];

export type ScriptHostImplementationMap = SandboxHostImplementationMap<ScriptRunInput>;

export type ScriptRunInput = Omit<SandboxRunInput, "principal"> & {
	readonly principal: ScriptExecutionPrincipal;
};

export type AdditionalScriptHostImplementationMap = Omit<
	ScriptHostImplementationMap,
	| "log"
	| "span"
	| "httpCall"
	| "setCachedValue"
	| "getCachedValue"
	| "getPersistentValue"
	| "claimPersistentValue"
>;

export type UserSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<ScriptExecutionPrincipal["subject"], { readonly type: "user" }>
			| Extract<ScriptExecutionPrincipal["subject"], { readonly type: "projection" }>
			| ({ readonly executionUserId: UserId } & Extract<
					ScriptExecutionPrincipal["subject"],
					{ readonly type: "automation-run" }
			  >);
	};
};

type CapabilitySubject<Capability extends SandboxHostCapability> =
	(typeof SANDBOX_CAPABILITY_REQUIREMENTS)[Capability]["subjects"][number];

type DirectUserSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject: Extract<ScriptExecutionPrincipal["subject"], { readonly type: "user" }>;
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

type SystemSandboxRunInput<Input extends ScriptRunInput = ScriptRunInput> = Input & {
	readonly principal: Input["principal"] & {
		readonly subject:
			| Extract<ScriptExecutionPrincipal["subject"], { readonly type: "system" }>
			| ({ readonly executionUserId: null } & Extract<
					ScriptExecutionPrincipal["subject"],
					{ readonly type: "automation-run" }
			  >);
	};
};

type SandboxRunInputForCapability<
	Capability extends SandboxHostCapability,
	Input extends ScriptRunInput = ScriptRunInput,
> =
	"agent" extends CapabilitySubject<Capability>
		? SandboxRunInputForSubject<Input, CapabilitySubject<Capability>>
		: "system" extends CapabilitySubject<Capability>
			? SandboxRunInputForSubject<Input, CapabilitySubject<Capability>>
			: UserSandboxRunInput<Input> &
					SandboxRunInputForSubject<Input, CapabilitySubject<Capability>>;

type SandboxRunInputForSubject<Input extends ScriptRunInput, Subject> = Subject extends "user"
	? DirectUserSandboxRunInput<Input>
	: Subject extends "agent"
		? Input & {
				readonly principal: Input["principal"] & {
					readonly subject: Extract<
						ScriptExecutionPrincipal["subject"],
						{ readonly type: "agent" }
					>;
				};
			}
		: Subject extends "projection"
			? Input & {
					readonly principal: Input["principal"] & {
						readonly subject: Extract<
							ScriptExecutionPrincipal["subject"],
							{ readonly type: "projection" }
						>;
					};
				}
			: Subject extends "automation-run"
				? AutomationRunSandboxRunInput<Input>
				: Subject extends "system"
					? SystemSandboxRunInput<Input>
					: never;

const sandboxCapabilityError = (
	input: Pick<ScriptRunInput, "principal">,
	capability: SandboxHostCapability,
) => {
	const requirement = sandboxCapabilityRequirement(capability);
	const subject = input.principal.subject;
	if (
		subject.type === "projection" &&
		!POLICY_SAFE_SANDBOX_CAPABILITIES.some((safe) => safe === capability)
	) {
		return `${capability} is not available to projection runs`;
	}
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
			return `${capability} is not available for system executions`;
		}
		if (
			requirement.systemKinds &&
			!requirement.systemKinds.some((kind) => kind === input.principal.metadata.kind)
		) {
			return `${capability} is not available to this system execution`;
		}
	} else if (!requirement.subjects.includes(input.principal.subject.type)) {
		if (requirement.subjects.length === 1 && requirement.subjects[0] === "user") {
			return `${capability} is available only to user executions`;
		}
		return `${capability} is not available to this execution`;
	}
	if (
		system &&
		requirement.requiresSystemPlugin &&
		input.principal.pluginRevision?.scope !== "system"
	) {
		return `${capability} system access requires a pinned system plugin script`;
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
