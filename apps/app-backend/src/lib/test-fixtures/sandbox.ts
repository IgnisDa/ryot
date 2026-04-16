import type {
	SandboxScriptServiceDeps,
	SandboxServiceDeps,
} from "~/modules/sandbox";

const sandboxScriptDefault = {
	id: "script_1",
	name: "My Script",
	slug: "my-script",
	code: 'driver("main", async function() { return 1; });',
};

export const createSandboxDeps = (
	overrides: Partial<SandboxServiceDeps> = {},
): SandboxServiceDeps => ({
	getSandboxJobByIdForUser: async () => null,
	getSandboxScriptForUser: async () => undefined,
	enqueueSandboxJob: async () => ({ jobId: "job_1" }),
	...overrides,
});

export const createSandboxScriptDeps = (
	overrides: Partial<SandboxScriptServiceDeps> = {},
): SandboxScriptServiceDeps => ({
	getSandboxScriptBySlugForUser: async () => undefined,
	createSandboxScriptForUser: async () => sandboxScriptDefault,
	...overrides,
});
