import { expect, it } from "@effect/vitest";
import { Cause, Effect, Layer } from "effect";

import { makeRedisService } from "#lib/test-utils/effect";

import { RedisService } from "../redis";
import { SandboxHarvestHandleStore } from "./harvest-handles";

const makeLayer = () => {
	const hashes = new Map<string, Map<string, string>>();
	const client = Object.assign(Object.create(null), {
		expire: () => Promise.resolve(1),
		hmget: (key: string, ...fields: string[]) =>
			Promise.resolve(fields.map((field) => hashes.get(key)?.get(field) ?? null)),
		hset: (key: string, ...fields: string[]) => {
			const hash = hashes.get(key) ?? new Map<string, string>();
			for (let index = 0; index < fields.length; index += 2) {
				const field = fields[index];
				const value = fields[index + 1];
				if (field !== undefined && value !== undefined) {
					hash.set(field, value);
				}
			}
			hashes.set(key, hash);
			return Promise.resolve(fields.length / 2);
		},
		del: (...keys: string[]) => {
			keys.forEach((key) => hashes.delete(key));
			return Promise.resolve(keys.length);
		},
	});

	return SandboxHarvestHandleStore.layer.pipe(
		Layer.provide(
			Layer.succeed(
				RedisService,
				Object.assign(Object.create(null), {
					...makeRedisService(),
					client,
					del: (...keys: string[]) =>
						Effect.sync(() => {
							keys.forEach((key) => hashes.delete(key));
						}),
				}),
			),
		),
	);
};

it.effect("stores opaque handles scoped to workflow execution", () =>
	Effect.gen(function* () {
		const store = yield* SandboxHarvestHandleStore;
		const handles = yield* store.register("workflow-1", ["/tmp/harvest/chunk.json"]);

		expect(handles).toHaveLength(1);
		expect(handles[0]).not.toBe("/tmp/harvest/chunk.json");
		expect(yield* store.resolve("workflow-1", handles)).toEqual(["/tmp/harvest/chunk.json"]);

		const otherWorkflow = yield* Effect.exit(store.resolve("workflow-2", handles));
		expect(otherWorkflow._tag).toBe("Failure");
		if (otherWorkflow._tag === "Failure") {
			expect(Cause.pretty(otherWorkflow.cause)).toContain("was not found");
		}
	}).pipe(Effect.provide(makeLayer())),
);

it.effect("releases all handles for workflow execution", () =>
	Effect.gen(function* () {
		const store = yield* SandboxHarvestHandleStore;
		const handles = yield* store.register("workflow-1", ["/tmp/harvest/chunk.json"]);
		yield* store.release("workflow-1");

		const result = yield* Effect.exit(store.resolve("workflow-1", handles));
		expect(result._tag).toBe("Failure");
	}).pipe(Effect.provide(makeLayer())),
);
