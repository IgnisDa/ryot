import { expect, it } from "@effect/vitest";
import { PluginPackageId, UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";

import { isUserBootstrapPrincipal, ScriptExecutionPrincipal } from "./principal";

const encodeJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

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

it.effect(
	"retains exact revision/config pins in durable principals and rejects conflicting ownership",
	() =>
		Effect.gen(function* () {
			const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(ScriptExecutionPrincipal));
			expect(yield* decode(yield* encodeJson(principal))).toEqual(principal);
			for (const changes of [
				{ id: "other-plugin" },
				{ revisionId: "other-revision" },
				{ configRevisionId: "other-config" },
				{ ownerId: "other-user" },
				{ ownerId: null },
			]) {
				yield* Effect.flip(
					decode(
						yield* encodeJson({
							...principal,
							pluginRevision: { ...principal.pluginRevision, ...changes },
						}),
					),
				);
			}
			yield* Effect.flip(
				decode(
					yield* encodeJson({
						...principal,
						subject: { ...principal.subject, executionUserId: null },
					}),
				),
			);
		}),
);

it.effect("accepts source-zero principals only with all-null plugin ownership", () =>
	Effect.gen(function* () {
		const decode = Schema.decodeUnknownEffect(ScriptExecutionPrincipal);
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
		expect(yield* decode(kernel)).toEqual(kernel);
		yield* Effect.flip(decode({ ...principal, pluginRevision: null }));
		yield* Effect.flip(decode({ ...kernel, pluginRevision: principal.pluginRevision }));
	}),
);

it.effect("rejects kernel identity together with a plugin revision", () =>
	Effect.gen(function* () {
		const decode = Schema.decodeUnknownEffect(ScriptExecutionPrincipal);
		expect((yield* Effect.flip(decode({ ...principal, kernelScript: true }))).message).toContain(
			"Kernel identity cannot accompany a plugin revision",
		);
	}),
);

it.effect("recognizes only a declared user bootstrap script as a bootstrap principal", () =>
	Effect.gen(function* () {
		const decode = Schema.decodeUnknownEffect(ScriptExecutionPrincipal);
		const bootstrap = (metadata: { kind: string }, slugs: string[]) =>
			Effect.map(
				decode({
					...principal,
					metadata: { ...metadata, runtimeImports: [] },
					pluginRevision: { ...principal.pluginRevision, userBootstrapScriptSlugs: slugs },
				}),
				isUserBootstrapPrincipal,
			);

		expect(yield* bootstrap({ kind: "script" }, ["script"])).toBe(true);
		expect(yield* bootstrap({ kind: "script" }, ["other"])).toBe(false);
		expect(yield* bootstrap({ kind: "automation" }, ["script"])).toBe(false);
	}),
);
