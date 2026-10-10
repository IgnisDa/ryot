import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/sandbox/wire";
import {
	AutomationExecutionId,
	AutomationRunId,
	AutomationTriggerId,
	SandboxScriptId,
	UserId,
	type SandboxProviderId,
} from "@ryot-app/contract/schema/brands";

import type { ScriptExecutionPrincipal } from "../protocol/principal";
import type { SandboxRunInput } from "./invocation";

export const testAccountGeneration = (userId: UserId) => ({
	userId,
	token: "test-account-generation" as const,
});

export const makeUserSubject = (userId = UserId.make("user-1")) => ({
	userId,
	type: "user" as const,
	accountGeneration: testAccountGeneration(userId),
});

export const makeUserPrincipal = (
	overrides: Partial<ScriptExecutionPrincipal> = {},
): ScriptExecutionPrincipal => ({
	contentHash: "",
	providerId: null,
	scriptSlug: "script",
	pluginRevision: null,
	subject: makeUserSubject(),
	metadata: { runtimeImports: [] },
	scriptId: SandboxScriptId.make("script-1"),
	...overrides,
});

export const makeUserRunInput = ({
	principal,
	...overrides
}: Partial<Omit<SandboxRunInput, "principal">> & {
	readonly principal?: Partial<ScriptExecutionPrincipal>;
} = {}): SandboxRunInput => ({
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	lane: "interactive",
	executionId: "execution-1",
	startedAt: "2026-01-01T00:00:00.000Z",
	principal: makeUserPrincipal(principal),
	...overrides,
});

export const makeSubjectRunInput = (
	subject: SandboxExecutionSubject,
	providerId: SandboxProviderId | null = null,
	metadata: Omit<SandboxScriptMetadata, "runtimeImports"> = {},
	principalFacts: Partial<ScriptExecutionPrincipal> = {},
): SandboxRunInput => ({
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	lane: "interactive",
	executionId: "exec_1",
	startedAt: "2026-01-01T00:00:00.000Z",
	principal: {
		subject,
		providerId,
		contentHash: "",
		scriptSlug: "script",
		pluginRevision: null,
		scriptId: SandboxScriptId.make("script_1"),
		metadata: { runtimeImports: [], capabilities: [...SANDBOX_HOST_CAPABILITIES], ...metadata },
		...principalFacts,
	},
});

export const automationRunSubject = (
	stage: "before" | "after",
	executionUserId: UserId | null,
): Extract<SandboxExecutionSubject, { type: "automation-run" }> => ({
	stage,
	pluginId: null,
	executionUserId,
	type: "automation-run",
	pluginRevisionId: null,
	pluginConfigRevisionId: null,
	runId: AutomationRunId.make("run_1"),
	triggerId: AutomationTriggerId.make("trigger_1"),
	delivery: stage === "before" ? "policy" : "required",
	accountGeneration:
		executionUserId === null ? null : { userId: executionUserId, token: "test-account-generation" },
	causation: {
		depth: 0,
		source: "api",
		parentRunId: null,
		lane: "interactive",
		parentTriggerId: null,
		initiator: { id: null, kind: "system" },
		executionId: AutomationExecutionId.make("execution_1"),
		rootExecutionId: AutomationExecutionId.make("execution_1"),
	},
});
