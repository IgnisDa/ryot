import type {
	SandboxExecutionSubject,
	SandboxScriptMetadata,
} from "@ryot-app/contract/modules/scripts/schemas";
import { SANDBOX_HOST_CAPABILITIES } from "@ryot-app/contract/modules/scripts/wire";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginPackageId,
	PluginRevisionId,
	type SandboxProviderId,
	SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { scriptsDigestOf } from "@ryot-app/sandbox/host/executor.test-support";
import { makeUserSubject } from "@ryot-app/sandbox/host/run-input.test-support";

import type { ScriptRunInput } from "./capabilities";
import type {
	PluginSchemaScope,
	ScriptExecutionPrincipal,
	ScriptPluginRevision,
} from "./principal";

export const emptyScriptsDigest = scriptsDigestOf({});

export const emptySchemaScope: PluginSchemaScope = {
	eventSchemas: [],
	entitySchemaSlugs: [],
	signalSchemaSlugs: [],
	relationshipSchemaSlugs: [],
};

export const makeUserPluginRevision = (input: {
	readonly slug: string;
	readonly ownerId: null | UserId;
	readonly compiledHashes: Readonly<Record<string, string>>;
}): ScriptPluginRevision => ({
	scope: "user",
	workflowScripts: {},
	ownerId: input.ownerId,
	userBootstrapScriptSlugs: [],
	id: PluginId.make(input.slug),
	packageId: PluginPackageId.make("test/fixture"),
	configSchema: { fields: {}, unknownKeys: "strict" },
	scriptsDigest: scriptsDigestOf(input.compiledHashes),
	revisionId: PluginRevisionId.make(`${input.slug}-revision`),
	configRevisionId: PluginConfigRevisionId.make(`${input.slug}-config`),
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
}: Partial<Omit<ScriptRunInput, "principal">> & {
	readonly principal?: Partial<ScriptExecutionPrincipal>;
} = {}): ScriptRunInput => ({
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
	providerId: null | SandboxProviderId = null,
	metadata: Omit<SandboxScriptMetadata, "runtimeImports"> = {},
	principalFacts: Partial<ScriptExecutionPrincipal> = {},
): ScriptRunInput => ({
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
