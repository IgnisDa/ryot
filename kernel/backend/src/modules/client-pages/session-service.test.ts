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
	hashPluginClientArtifactSessionToken,
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
	installationId: "private-installation-id",
	pluginSlug: PluginSlug.make("private"),
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
	target: { kind: "saved-view", savedViewId },
	contributors: [rendererContributor, privateContributor],
	operationTargets: [
		{
			pluginId: "target-plugin-id",
			sourceHash: "target-source-1",
			installationId: "target-installation-id",
			pluginSlug: PluginSlug.make("target"),
		},
	],
};

const makeLayer = (currentIdentity: PreparedClientPage["identity"], fileReads: string[]) => {
	const raw = Schema.encodeUnknownSync(ClientPageSessionPayloadFromJson)({ userId, identity });
	return ClientPageSessionService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				databaseLayer,
				Layer.succeed(
					RedisService,
					makeRedisService({
						client: Object.assign(Object.create(null), {
							get: (key: string) =>
								Promise.resolve(
									key.endsWith(hashPluginClientArtifactSessionToken(token)) ? raw : null,
								),
						}),
					}),
				),
				Layer.succeed(
					ClientPagesService,
					ClientPagesService.of(
						Object.assign(Object.create(null), {
							isIdentityCurrent: () => Effect.succeed(Bun.deepEquals(currentIdentity, identity)),
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
									return { contentType: "text/javascript", contents: new Uint8Array([1]) };
								}),
						}),
					),
				),
			),
		),
	);
};

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
