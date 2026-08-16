import { Schema } from "effect";
import { expect, it } from "vitest";

import { SandboxExecutionPrincipal } from "./execution-principal";

const principal = {
	providerId: null,
	scriptId: "script-1",
	scriptSlug: "script",
	contentHash: "hash-1",
	metadata: { kind: "automation" },
	pluginRevision: {
		scope: "user",
		id: "plugin-1",
		slug: "plugin",
		ownerId: "user-1",
		workflowScripts: {},
		revisionId: "revision-1",
		configRevisionId: "config-1",
		userBootstrapScriptSlugs: [],
		compiledHashes: { script: "hash-1" },
		configSchema: { fields: {}, unknownKeys: "strict" },
		schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
	},
	subject: {
		runId: "run-1",
		stage: "after",
		pluginId: "plugin-1",
		type: "automation-run",
		triggerId: "trigger-1",
		executionUserId: "user-1",
		pluginRevisionId: "revision-1",
		pluginConfigRevisionId: "config-1",
		causation: {
			depth: 0,
			source: "api",
			parentRunId: null,
			parentTriggerId: null,
			executionId: "execution-1",
			rootExecutionId: "execution-1",
			initiator: { id: null, kind: "system" },
		},
	},
};

it("retains exact revision/config pins in durable principals and rejects conflicting ownership", () => {
	const decode = Schema.decodeUnknownSync(Schema.fromJsonString(SandboxExecutionPrincipal));
	expect(decode(JSON.stringify(principal))).toEqual(principal);
	for (const changes of [
		{ id: "other-plugin" },
		{ revisionId: "other-revision" },
		{ configRevisionId: "other-config" },
		{ ownerId: "other-user" },
		{ ownerId: null },
	]) {
		expect(() =>
			decode(
				JSON.stringify({
					...principal,
					pluginRevision: { ...principal.pluginRevision, ...changes },
				}),
			),
		).toThrow();
	}
	expect(() =>
		decode(
			JSON.stringify({ ...principal, subject: { ...principal.subject, executionUserId: null } }),
		),
	).toThrow();
});

it("accepts source-zero principals only with all-null plugin ownership", () => {
	const decode = Schema.decodeUnknownSync(SandboxExecutionPrincipal);
	const kernel = {
		...principal,
		pluginRevision: null,
		subject: {
			...principal.subject,
			pluginId: null,
			pluginRevisionId: null,
			pluginConfigRevisionId: null,
		},
	};
	expect(decode(kernel)).toEqual(kernel);
	expect(() => decode({ ...principal, pluginRevision: null })).toThrow();
	expect(() => decode({ ...kernel, pluginRevision: principal.pluginRevision })).toThrow();
});
