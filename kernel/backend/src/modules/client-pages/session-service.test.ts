import { expect, it } from "@effect/vitest";
import type { PreparedClientPage } from "@ryot-app/contract/modules/client-pages/schemas";
import {
	ClientRendererId,
	PluginSlug,
	SavedViewId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { Effect, Layer, Schema } from "effect";

import {
	ClientPageSessionPayloadFromJson,
	hashClientPageSessionToken,
	RedisService,
} from "#lib/infrastructure/redis";
import { databaseLayer, makeRedisService } from "#lib/test-utils/effect";

import { ClientPagesRepository } from "./repository";
import { ClientPagesService } from "./service";
import { ClientPageSessionService } from "./session-service";

const token = "a".repeat(43);
const userId = UserId.make("user-1");
const savedViewId = SavedViewId.make("view-1");
const rendererId = ClientRendererId.make("renderer-1");
const privateContributor = {
	kind: "plugin" as const,
	pluginId: "private-plugin-id",
	sourceHash: "private-source-1",
	pluginSlug: PluginSlug.make("private"),
	installationId: "private-installation-id",
};
const rendererContributor = {
	rendererId,
	kind: "renderer" as const,
	sourceHash: "renderer-source-1",
};
const identity: PreparedClientPage["identity"] = {
	rendererId,
	savedViewId,
	viewRevision: 1,
	kind: "saved-view",
	buildId: "build-1",
	graphHash: "graph-1",
	publishedRevision: 1,
	artifactHash: "artifact-1",
	publishedHash: "renderer-source-1",
	target: { savedViewId, kind: "saved-view" },
	contributors: [rendererContributor, privateContributor],
	operationTargets: [
		{
			pluginId: "target-plugin-id",
			sourceHash: "target-source-1",
			pluginSlug: PluginSlug.make("target"),
			installationId: "target-installation-id",
		},
	],
};

const makeLayer = (
	currentIdentity: PreparedClientPage["identity"],
	fileReads: string[],
	options: {
		readonly isIdentityCurrent?: () => boolean;
		readonly onSet?: (key: string, value: string) => void;
		readonly onReleaseLease?: (key: string, value: string) => void;
	} = {},
) => {
	const raw = Schema.encodeUnknownSync(ClientPageSessionPayloadFromJson)({ userId, identity });
	return ClientPageSessionService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(
					RedisService,
					makeRedisService({
						renewLease: () => Effect.succeed(true),
						releaseLease: (key, value) => Effect.sync(() => options.onReleaseLease?.(key, value)),
						client: Object.assign(Object.create(null), {
							get: (key: string) =>
								Promise.resolve(key.endsWith(hashClientPageSessionToken(token)) ? raw : null),
							set: (key: string, value: string) => {
								options.onSet?.(key, value);
								return Promise.resolve("OK" as const);
							},
						}),
					}),
				),
				Layer.succeed(
					ClientPagesService,
					ClientPagesService.of(
						Object.assign(Object.create(null), {
							isIdentityCurrent: () =>
								Effect.sync(
									() => options.isIdentityCurrent?.() ?? Bun.deepEquals(currentIdentity, identity),
								),
						}),
					),
				),
				Layer.succeed(
					ClientPagesRepository,
					ClientPagesRepository.of(
						Object.assign(Object.create(null), {
							findArtifactFile: (_hash: string, name: string) =>
								Effect.sync(() => {
									fileReads.push(name);
									return { contents: new Uint8Array([1]), contentType: "text/javascript" };
								}),
						}),
					),
				),
			),
		),
	);
};

it.effect("releases a newly stored session when its identity becomes stale", () => {
	let checks = 0;
	let stored: readonly [string, string] | undefined;
	const releases: (readonly [string, string])[] = [];
	return Effect.gen(function* () {
		const sessions = yield* ClientPageSessionService;
		const error = yield* Effect.flip(sessions.create(userId, identity));
		expect(error._tag).toBe("ClientPageStalePreparation");
		expect(checks).toBe(2);
		expect(releases).toEqual([stored]);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				makeLayer(identity, [], {
					isIdentityCurrent: () => ++checks === 1,
					onReleaseLease: (key, value) => releases.push([key, value]),
					onSet: (key, value) => {
						stored = [key, value];
					},
				}),
				databaseLayer,
			),
		),
	);
});

it.effect("serves an artifact while every composed contributor identity is current", () => {
	const fileReads: string[] = [];
	return Effect.gen(function* () {
		const sessions = yield* ClientPageSessionService;
		const file = yield* sessions.findFile(token, "plugin.js");
		expect(file.contents).toEqual(new Uint8Array([1]));
		expect(fileReads).toEqual(["plugin.js"]);
	}).pipe(Effect.provide(Layer.mergeAll(makeLayer(identity, fileReads), databaseLayer)));
});

it.effect("rejects artifact access when a private contributor revision changes", () => {
	const fileReads: string[] = [];
	const currentIdentity = {
		...identity,
		graphHash: "graph-2",
		contributors: [rendererContributor, { ...privateContributor, sourceHash: "private-source-2" }],
	};
	return Effect.gen(function* () {
		const sessions = yield* ClientPageSessionService;
		const error = yield* Effect.flip(sessions.findFile(token, "plugin.js"));
		expect(error._tag).toBe("ClientPageSessionNotFound");
		expect(fileReads).toEqual([]);
	}).pipe(Effect.provide(Layer.mergeAll(makeLayer(currentIdentity, fileReads), databaseLayer)));
});

it.effect("rejects artifact access when a recorded operation target revision changes", () => {
	const fileReads: string[] = [];
	const currentIdentity = {
		...identity,
		operationTargets: identity.operationTargets.map((target) =>
			Object.assign({}, target, { sourceHash: "target-source-2" }),
		),
	};
	return Effect.gen(function* () {
		const sessions = yield* ClientPageSessionService;
		const error = yield* Effect.flip(sessions.findFile(token, "plugin.js"));
		expect(error._tag).toBe("ClientPageSessionNotFound");
		expect(fileReads).toEqual([]);
	}).pipe(Effect.provide(Layer.mergeAll(makeLayer(currentIdentity, fileReads), databaseLayer)));
});

it.effect("returns stale preparation when renewing a stale session", () => {
	const currentIdentity = { ...identity, graphHash: "graph-2" };
	return Effect.gen(function* () {
		const sessions = yield* ClientPageSessionService;
		const error = yield* Effect.flip(sessions.renew(userId, hashClientPageSessionToken(token)));
		expect(error._tag).toBe("ClientPageStalePreparation");
	}).pipe(Effect.provide(Layer.mergeAll(makeLayer(currentIdentity, []), databaseLayer)));
});

it.effect("keeps malformed, missing, and wrong-user renewals as not found", () => {
	return Effect.gen(function* () {
		const sessions = yield* ClientPageSessionService;
		const wrongUser = yield* Effect.flip(
			sessions.renew(UserId.make("user-2"), hashClientPageSessionToken(token)),
		);
		const missing = yield* Effect.flip(sessions.renew(userId, "b".repeat(64)));
		const malformed = yield* Effect.flip(sessions.renew(userId, "malformed"));
		expect(wrongUser._tag).toBe("ClientPageSessionNotFound");
		expect(missing._tag).toBe("ClientPageSessionNotFound");
		expect(malformed._tag).toBe("ClientPageSessionNotFound");
	}).pipe(Effect.provide(Layer.mergeAll(makeLayer(identity, []), databaseLayer)));
});
