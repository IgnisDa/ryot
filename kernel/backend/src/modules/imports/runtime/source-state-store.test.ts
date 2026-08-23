import { expect, layer } from "@effect/vitest";
import {
	PluginConfigRevisionId,
	PluginId,
	PluginRevisionId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref, Schema } from "effect";
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

type PendingWrite = { key: string; value: string; ttlSeconds: number | undefined };
type ClaimInput = { key: string; claimKey: string; ttlSeconds: number };

class FakeSourceStateRedis extends Context.Service<
	FakeSourceStateRedis,
	{
		readonly pending: Effect.Effect<PendingWrite | undefined>;
		readonly claimInput: Effect.Effect<ClaimInput | undefined>;
		readonly deleted: Effect.Effect<ReadonlyArray<ReadonlyArray<string>>>;
	}
>()("test/FakeSourceStateRedis") {}

const recordingRedisLayer = Layer.unwrap(
	Effect.gen(function* () {
		const pending = yield* Ref.make<PendingWrite | undefined>(undefined);
		const claimInput = yield* Ref.make<ClaimInput | undefined>(undefined);
		const deleted = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
		return Layer.merge(
			Layer.succeed(FakeSourceStateRedis, {
				pending: Ref.get(pending),
				deleted: Ref.get(deleted),
				claimInput: Ref.get(claimInput),
			}),
			Layer.succeed(
				RedisService,
				makeRedisService({
					set: (key, value, ttlSeconds) => Ref.set(pending, { key, value, ttlSeconds }),
					del: (...keys) =>
						Ref.update(deleted, (all) => [...all, [...keys]]).pipe(Effect.as(keys.length)),
					claim: (key, claimKey, ttlSeconds) =>
						Ref.set(claimInput, { key, claimKey, ttlSeconds }).pipe(
							Effect.andThen(Ref.get(pending)),
							Effect.map((write) => write?.value ?? null),
						),
				}),
			),
		);
	}),
);

layer(recordingRedisLayer)((test) => {
	test.effect("stores, claims, and deletes import source state with bounded lifecycle keys", () =>
		Effect.gen(function* () {
			const redis = yield* FakeSourceStateRedis;
			yield* storeImportSourceState({ state, stateId: "state-1" });
			const pending = yield* redis.pending;
			expect(pending).toMatchObject({
				key: redisKeys.importSourceState("state-1"),
				ttlSeconds: IMPORT_SOURCE_STATE_PENDING_TTL_SECONDS,
			});
			assert(pending);
			expect(yield* Schema.decodeEffect(ImportSourceStateFromJson)(pending.value)).toEqual(state);

			expect(yield* claimImportSourceState("state-1", "execution-1")).toEqual(state);
			expect(yield* redis.claimInput).toEqual({
				key: redisKeys.importSourceState("state-1"),
				ttlSeconds: IMPORT_SOURCE_STATE_CLAIMED_TTL_SECONDS,
				claimKey: redisKeys.importSourceStateClaim("state-1", "execution-1"),
			});

			yield* deleteImportSourceState("state-1", "execution-1");
			expect(yield* redis.deleted).toEqual([
				[
					redisKeys.importSourceState("state-1"),
					redisKeys.importSourceStateClaim("state-1", "execution-1"),
				],
			]);
		}),
	);
});
