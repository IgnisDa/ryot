import { PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { ScriptExecutionWorkflowPayload } from "../executions/workflow-payload";
import { isUserBootstrapPrincipal, ScriptExecutionPrincipal } from "./principal";

const principal = {
	providerId: null,
	scriptId: "script-1",
	scriptSlug: "script",
	contentHash: "hash-1",
	metadata: { kind: "automation", runtimeImports: [] },
	pluginRevision: {
		scope: "user",
		id: "plugin-1",
		ownerId: "user-1",
		workflowScripts: {},
		revisionId: "revision-1",
		configRevisionId: "config-1",
		userBootstrapScriptSlugs: [],
		compiledHashes: { script: "hash-1" },
		packageId: PluginPackageId.make("test/principal"),
		configSchema: { fields: {}, unknownKeys: "strict" },
		schemaScope: {
			eventSchemas: [],
			signalSchemaSlugs: [],
			entitySchemaSlugs: [],
			relationshipSchemaSlugs: [],
		},
	},
	subject: {
		runId: "run-1",
		stage: "after",
		delivery: "required",
		pluginId: "plugin-1",
		type: "automation-run",
		triggerId: "trigger-1",
		executionUserId: "user-1",
		pluginRevisionId: "revision-1",
		pluginConfigRevisionId: "config-1",
		accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
		causation: {
			depth: 0,
			source: "api",
			parentRunId: null,
			lane: "interactive",
			parentTriggerId: null,
			executionId: "execution-1",
			rootExecutionId: "execution-1",
			initiator: { id: null, kind: "system" },
		},
	},
};

it("retains trusted after-hook suppression with the exact pins and user generation", () => {
	const user = {
		...principal,
		metadata: { kind: "script", runtimeImports: [] },
		subject: {
			type: "user",
			userId: "user-1",
			afterHooks: "skip",
			accountGeneration: principal.subject.accountGeneration,
		},
	};
	const decoded = Schema.decodeUnknownSync(ScriptExecutionPrincipal)(user);
	expect(
		Schema.decodeSync(Schema.fromJsonString(ScriptExecutionPrincipal))(JSON.stringify(user)),
	).toEqual(decoded);
	const payload = {
		lane: "background",
		resolutionMode: "exact",
		subject: decoded.subject,
		scriptId: decoded.scriptId,
		executionId: "repair-script",
		input: { afterHooks: "normal" },
		pluginRevision: decoded.pluginRevision,
	};
	expect(
		Schema.decodeSync(Schema.fromJsonString(ScriptExecutionWorkflowPayload))(
			JSON.stringify(payload),
		),
	).toEqual(payload);
});

it("retains exact revision/config pins in durable principals and rejects conflicting ownership", () => {
	const decode = Schema.decodeUnknownSync(Schema.fromJsonString(ScriptExecutionPrincipal));
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
	const decode = Schema.decodeUnknownSync(ScriptExecutionPrincipal);
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

it("rejects kernel identity together with a plugin revision", () => {
	const decode = Schema.decodeUnknownSync(ScriptExecutionPrincipal);
	expect(() => decode({ ...principal, kernelScript: true })).toThrow(
		"Kernel identity cannot accompany a plugin revision",
	);
});

it("recognizes only a declared user bootstrap script as a bootstrap principal", () => {
	const decode = Schema.decodeUnknownSync(ScriptExecutionPrincipal);
	const bootstrap = (metadata: { kind: string }, slugs: string[]) =>
		isUserBootstrapPrincipal(
			decode({
				...principal,
				metadata: { ...metadata, runtimeImports: [] },
				pluginRevision: { ...principal.pluginRevision, userBootstrapScriptSlugs: slugs },
			}),
		);

	expect(bootstrap({ kind: "script" }, ["script"])).toBe(true);
	expect(bootstrap({ kind: "script" }, ["other"])).toBe(false);
	expect(bootstrap({ kind: "automation" }, ["script"])).toBe(false);
	expect(
		isUserBootstrapPrincipal(
			decode({
				...principal,
				metadata: { kind: "script", runtimeImports: [] },
				pluginRevision: { ...principal.pluginRevision, userBootstrapScriptSlugs: ["script"] },
				subject: {
					type: "user",
					userId: "user-1",
					afterHooks: "skip",
					accountGeneration: principal.subject.accountGeneration,
				},
			}),
		),
	).toBe(false);
});
