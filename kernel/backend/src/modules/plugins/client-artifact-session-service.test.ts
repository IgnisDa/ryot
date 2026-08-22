import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot/contract/modules/plugins/client";
import {
	PluginArtifactSessionNotFoundError,
	PluginConflictError,
	PluginNotFoundError,
} from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug, UserId } from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer, Option, Schema } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import {
	PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS,
	PluginClientArtifactSessionPayloadFromJson,
	RedisService,
} from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";

import { PluginClientArtifactSessionService } from "./client-artifact-session-service";
import { PluginRepository } from "./repository";

const artifact = {
	pluginId: "plugin-id",
	health: "ready" as const,
	sourceHash: "source-hash",
	artifactHash: "artifact-hash",
	clientApiVersion: CLIENT_API_VERSION,
	artifactFormat: CLIENT_ARTIFACT_FORMAT,
	compilerVersion: CLIENT_COMPILER_VERSION,
	pluginSlug: PluginSlug.make("fixture"),
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
};

const makeLayer = (input?: {
	raw?: string | null;
	readonly setResults?: Array<"OK" | null>;
	readonly writes?: Array<ReadonlyArray<unknown>>;
	readonly renewals?: Array<ReadonlyArray<unknown>>;
	readonly releases?: Array<ReadonlyArray<unknown>>;
	readonly artifact?:
		| (Omit<typeof artifact, "health"> & {
				readonly health: "ready" | "failed" | "installing" | "incompatible" | "needs-configuration";
		  })
		| null;
}) => {
	let raw = input?.raw;
	const redis = makeRedisService({
		client: Object.assign(Object.create(null), {
			get: () => Promise.resolve(raw ?? null),
			set: (...args: ReadonlyArray<unknown>) => {
				input?.writes?.push(args);
				raw = String(args[1]);
				return Promise.resolve(
					input?.setResults && input.setResults.length > 0 ? input.setResults.shift() : "OK",
				);
			},
		}),
		renewLease: (...args: ReadonlyArray<unknown>) =>
			Effect.sync(() => {
				input?.renewals?.push(args);
				return true;
			}),
		releaseLease: (...args: ReadonlyArray<unknown>) =>
			Effect.sync(() => void input?.releases?.push(args)),
	});
	const repository = PluginRepository.of(
		Object.assign(Object.create(null), {
			findPrivateClientArtifact: () =>
				Effect.succeed(input?.artifact === undefined ? artifact : input.artifact),
			findPrivateClientArtifactFile: () =>
				Effect.succeed({
					name: "plugin.js",
					contentType: "application/octet-stream",
					contents: new Uint8Array([0, 255]),
				}),
		}),
	);
	const service = PluginClientArtifactSessionService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(RedisService, redis),
				Layer.succeed(PluginRepository, repository),
			),
		),
	);
	return Layer.mergeAll(service, Layer.succeed(Database, Object.create(null)));
};

it.effect("creates a random hashed session with NX EX 900", () => {
	const writes: Array<ReadonlyArray<unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginClientArtifactSessionService;
		const created = yield* service.create({
			...artifact,
			installationId: "installation-id",
			userId: UserId.make("user-id"),
		});

		expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(writes).toHaveLength(1);
		expect(writes[0]?.[0]).toBe(`ryot:plugins:client-artifact-session:${created.sessionId}`);
		expect(writes[0]?.[0]).not.toContain(created.token);
		expect(writes[0]?.slice(2)).toEqual(["EX", PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS, "NX"]);
		expect(
			yield* Schema.decodeUnknownEffect(PluginClientArtifactSessionPayloadFromJson)(writes[0]?.[1]),
		).toEqual({
			pluginId: artifact.pluginId,
			pluginSlug: artifact.pluginSlug,
			sourceHash: artifact.sourceHash,
			installationId: "installation-id",
			artifactHash: artifact.artifactHash,
			userId: UserId.make("user-id"),
		});
	}).pipe(Effect.provide(makeLayer({ writes })));
});

it.effect("retries a token hash collision without replacing the existing record", () => {
	const writes: Array<ReadonlyArray<unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginClientArtifactSessionService;
		yield* service.create({
			...artifact,
			installationId: "installation-id",
			userId: UserId.make("user-id"),
		});

		expect(writes).toHaveLength(2);
		expect(writes.every((write) => write.slice(2).includes("NX"))).toBe(true);
	}).pipe(Effect.provide(makeLayer({ writes, setResults: [null, "OK"] })));
});

it.effect("classifies missing, stale, and blocked installation targets", () => {
	const input = {
		sourceHash: "source-hash",
		artifactHash: "artifact-hash",
		installationId: "installation-id",
		userId: UserId.make("user-id"),
		pluginSlug: PluginSlug.make("fixture"),
	};
	return Effect.gen(function* () {
		const missingExit = yield* Effect.exit(
			Effect.flatMap(PluginClientArtifactSessionService, (service) => service.create(input)).pipe(
				Effect.provide(makeLayer({ artifact: null })),
			),
		);
		expect(Exit.isFailure(missingExit)).toBe(true);
		if (!Exit.isFailure(missingExit)) {
			return;
		}
		const missing = Cause.findErrorOption(missingExit.cause);
		expect(Option.isSome(missing) && missing.value instanceof PluginNotFoundError).toBe(true);

		const staleExit = yield* Effect.exit(
			Effect.flatMap(PluginClientArtifactSessionService, (service) => service.create(input)).pipe(
				Effect.provide(makeLayer({ artifact: { ...artifact, sourceHash: "current-source" } })),
			),
		);
		expect(Exit.isFailure(staleExit)).toBe(true);
		if (!Exit.isFailure(staleExit)) {
			return;
		}
		const stale = Cause.findErrorOption(staleExit.cause);
		expect(
			Option.isSome(stale) &&
				stale.value instanceof PluginConflictError &&
				stale.value.reason.code === "source-revision-stale",
		).toBe(true);

		const blockedExit = yield* Effect.exit(
			Effect.flatMap(PluginClientArtifactSessionService, (service) => service.create(input)).pipe(
				Effect.provide(makeLayer({ artifact: { ...artifact, health: "installing" } })),
			),
		);
		expect(Exit.isFailure(blockedExit)).toBe(true);
		if (!Exit.isFailure(blockedExit)) {
			return;
		}
		const blocked = Cause.findErrorOption(blockedExit.cause);
		expect(
			Option.isSome(blocked) &&
				blocked.value instanceof PluginConflictError &&
				blocked.value.reason.code === "installation-not-ready",
		).toBe(true);

		const configurable = yield* Effect.flatMap(PluginClientArtifactSessionService, (service) =>
			service.create(input),
		).pipe(
			Effect.provide(makeLayer({ artifact: { ...artifact, health: "needs-configuration" } })),
			Effect.orDie,
		);
		expect(configurable.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});

it.effect("renews and revokes only with the exact stored payload", () => {
	const renewals: Array<ReadonlyArray<unknown>> = [];
	const releases: Array<ReadonlyArray<unknown>> = [];
	const sessionId = "a".repeat(64);
	const raw = Schema.encodeSync(PluginClientArtifactSessionPayloadFromJson)({
		pluginId: artifact.pluginId,
		pluginSlug: artifact.pluginSlug,
		sourceHash: artifact.sourceHash,
		installationId: "installation-id",
		artifactHash: artifact.artifactHash,
		userId: UserId.make("user-id"),
	});
	return Effect.gen(function* () {
		const service = yield* PluginClientArtifactSessionService;
		yield* service.renew({ sessionId, userId: UserId.make("user-id") });
		yield* service.revoke({ sessionId, userId: UserId.make("user-id") });

		expect(renewals[0]?.slice(1)).toEqual([raw, PLUGIN_CLIENT_ARTIFACT_SESSION_TTL_SECONDS]);
		expect(releases[0]?.slice(1)).toEqual([raw]);
	}).pipe(Effect.provide(makeLayer({ raw, renewals, releases })));
});

it.effect("rejects malformed stored payloads without exposing their contents", () => {
	const releases: Array<ReadonlyArray<unknown>> = [];
	return Effect.gen(function* () {
		const service = yield* PluginClientArtifactSessionService;
		const exit = yield* Effect.exit(service.findFile("a".repeat(43), "plugin.js"));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const failure = Cause.findErrorOption(exit.cause);
			expect(Option.isSome(failure) && failure.value).toEqual(
				new PluginArtifactSessionNotFoundError({
					reason: { code: "artifact-session-not-found" },
				}),
			);
			expect(String(exit.cause)).not.toContain("secret");
		}
		expect(releases).toHaveLength(1);
	}).pipe(
		Effect.provide(
			makeLayer({
				releases,
				raw: `${Schema.encodeSync(PluginClientArtifactSessionPayloadFromJson)({
					pluginId: artifact.pluginId,
					pluginSlug: artifact.pluginSlug,
					sourceHash: artifact.sourceHash,
					installationId: "installation-id",
					artifactHash: artifact.artifactHash,
					userId: UserId.make("user-id"),
				}).slice(0, -1)},"secret":"must-not-leak"}`,
			}),
		),
	);
});
