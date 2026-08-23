import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import {
	RedisService,
	redisKeys,
	hashClientPageArtifactGrantToken,
} from "#lib/infrastructure/redis";
import { makeRedisService } from "#lib/test-utils/effect";

import { ClientPageArtifactGrantService } from "./grant-service";
import { ClientPagesRepository } from "./repository";

it.effect("reuses a user artifact grant and serves immutable files without graph checks", () => {
	const data = new Map<string, string>();
	const reads: string[] = [];
	const layer = ClientPageArtifactGrantService.layer.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(Database, Database.of(Object.create(null))),
				Layer.succeed(
					RedisService,
					makeRedisService({
						get: (key) => Effect.succeed(data.get(key) ?? null),
						set: (key, value) =>
							Effect.sync(() => {
								data.set(key, value);
							}),
						client: Object.assign(Object.create(null), {
							ttl: () => Promise.resolve(900),
							set: (key: string, value: string) =>
								Promise.resolve(data.has(key) ? null : (data.set(key, value), "OK")),
						}),
					}),
				),
				Layer.succeed(
					ClientPagesRepository,
					ClientPagesRepository.of(
						Object.assign(Object.create(null), {
							findArtifactFile: (hash: string, name: string) =>
								Effect.sync(() => {
									reads.push(`${hash}/${name}`);
									return { contents: new Uint8Array([1]), contentType: "text/javascript" };
								}),
						}),
					),
				),
			),
		),
	);
	return Effect.gen(function* () {
		const grants = yield* ClientPageArtifactGrantService;
		const first = yield* grants.issue(UserId.make("user-1"), "artifact-1");
		const second = yield* grants.issue(UserId.make("user-1"), "artifact-1");
		expect(first.src).toBe(second.src);
		const token = first.src.split("/").at(-2);
		if (!token) {
			throw new Error("Expected an artifact grant token");
		}
		expect(first.grantId).toBe(hashClientPageArtifactGrantToken(token));
		expect(data.has(redisKeys.clientPageArtifactGrant(first.grantId))).toBe(true);
		const file = yield* grants.findFile(token, "plugin.js");
		expect(file.contents).toEqual(new Uint8Array([1]));
		expect(reads).toEqual(["artifact-1/plugin.js"]);
	}).pipe(
		Effect.provide(Layer.merge(layer, Layer.succeed(Database, Database.of(Object.create(null))))),
	);
});
