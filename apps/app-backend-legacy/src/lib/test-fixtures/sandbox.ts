import type { SandboxScriptServiceDeps, SandboxServiceDeps } from "~/modules/sandbox";

const sandboxScriptDefault = {
	metadata: {},
	id: "script_1",
	name: "My Script",
	slug: "my-script",
	code: 'driver("main", async function() { return 1; });',
};

export const createSandboxDeps = (
	overrides: Partial<SandboxServiceDeps> = {},
): SandboxServiceDeps => ({
	getSandboxJobByIdForUser: () => Promise.resolve(null),
	getSandboxScriptForUser: () => Promise.resolve(undefined),
	enqueueSandboxJob: () => Promise.resolve({ jobId: "job_1" }),
	...overrides,
});

export const createSandboxScriptDeps = (
	overrides: Partial<SandboxScriptServiceDeps> = {},
): SandboxScriptServiceDeps => ({
	getSandboxScriptBySlugForUser: () => Promise.resolve(undefined),
	createSandboxScriptForUser: () => Promise.resolve(sandboxScriptDefault),
	...overrides,
});
