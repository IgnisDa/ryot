import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";

import type { SandboxExecutionPrincipal } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import type { SandboxRunInput } from "#lib/infrastructure/sandbox-runtime/shared";

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
	overrides: Partial<SandboxExecutionPrincipal> = {},
): SandboxExecutionPrincipal => ({
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
	readonly principal?: Partial<SandboxExecutionPrincipal>;
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
