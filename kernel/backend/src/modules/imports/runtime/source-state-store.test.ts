import { expect, it } from "@effect/vitest";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";
import { assert } from "vitest";

import {
	IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
	IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
	ImportSourceStateFromJson,
	RedisService,
	redisKeys,
} from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";

import {
	claimImportSourceState,
	deleteImportSourceState,
	storeImportSourceState,
} from "./source-state-store";

const state = {
	source: "beta",
	pluginId: "example-plugin-id",
	uploadIntentIds: ["intent-1"],
	pluginInstallationId: "example-installation",
	namedArtifactPaths: { file: "/tmp/export.csv" },
	sourcePayload: { file: "file", apiKey: "secret" },
	workflowScriptId: SandboxScriptId.make("script-1"),
	pluginRevision: {
		ownerId: null,
		slug: "example",
		compiledHashes: {},
		workflowScripts: {},
		scope: "system" as const,
		userBootstrapScriptSlugs: [],
		id: PluginId.make("example-plugin-id"),
		revisionId: PluginRevisionId.make("example-revision"),
		configSchema: { fields: {}, unknownKeys: "strict" as const },
		configRevisionId: PluginConfigRevisionId.make("example-config-revision"),
		schemaScope: { eventSchemas: [], entitySchemaSlugs: [], relationshipSchemaSlugs: [] },
	},
};

it.effect("stores, claims, and deletes import source state with bounded lifecycle keys", () => {
	const deleted: string[][] = [];
	let pending: { key: string; value: string; ttlSeconds: number | undefined } | undefined;
	let claimInput: { key: string; claimKey: string; ttlSeconds: number } | undefined;
	const redis = makeRedisService({
		set: (key, value, ttlSeconds) => Effect.sync(() => void (pending = { key, value, ttlSeconds })),
		del: (...keys) =>
			Effect.sync(() => {
				deleted.push([...keys]);
				return keys.length;
			}),
		claim: (key, claimKey, ttlSeconds) =>
			Effect.sync(() => {
				claimInput = { key, claimKey, ttlSeconds };
				return pending?.value ?? null;
			}),
	});
	const layer = Layer.succeed(RedisService, redis);

	return Effect.gen(function* () {
		yield* storeImportSourceState({ state, stateId: "state-1" });
		expect(pending).toMatchObject({
			key: redisKeys.importSourceState("state-1"),
			ttlSeconds: IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
		});
		assert(pending);
		expect(yield* Schema.decodeEffect(ImportSourceStateFromJson)(pending.value)).toEqual(state);

		expect(yield* claimImportSourceState("state-1", "execution-1")).toEqual(state);
		expect(claimInput).toEqual({
			key: redisKeys.importSourceState("state-1"),
			ttlSeconds: IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
			claimKey: redisKeys.importSourceStateClaim("state-1", "execution-1"),
		});

		yield* deleteImportSourceState("state-1", "execution-1");
		expect(deleted).toEqual([
			[
				redisKeys.importSourceState("state-1"),
				redisKeys.importSourceStateClaim("state-1", "execution-1"),
			],
		]);
	}).pipe(Effect.provide(layer));
});
