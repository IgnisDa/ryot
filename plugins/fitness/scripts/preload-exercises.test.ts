import type { JsonValue, SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { cron, manifest } from "./providers/exercise/free-exercise-db.sandbox";

type PreloadHost = SandboxHost<typeof manifest.capabilities>;

const exercise = {
	images: [],
	force: "push",
	level: "beginner",
	name: "Bench Press",
	category: "strength",
	mechanic: "compound",
	equipment: "barbell",
	primaryMuscles: ["chest"],
	secondaryMuscles: ["triceps"],
	instructions: ["Push the bar up."],
};

const execution = { metadata: {}, sandboxScriptId: "preload-script" };

const makeHost = (
	dataset: readonly object[],
	configuredLimit: number,
	initialExternalIds: readonly string[] = [],
) => {
	const cache = new Map<string, JsonValue>();
	const entities = new Set(initialExternalIds);
	const calls: Array<{
		items: Parameters<PreloadHost["upsertGlobalEntities"]>[0];
		options: Parameters<PreloadHost["upsertGlobalEntities"]>[1];
	}> = [];
	const host = defineSandboxTestHost(manifest, {
		getAppConfigValue: () => Effect.succeed(configuredLimit),
		httpCall: () => Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(dataset) }),
		getCachedValue: (key) => Effect.succeed(cache.get(key) ?? null),
		setCachedValue: (key, value) => {
			cache.set(key, value);
			return Effect.succeed(null);
		},
		upsertGlobalEntities: (items, options) => {
			calls.push({ items, options });
			return Effect.succeed(
				items.map((item) => {
					if (entities.has(item.externalId)) {
						return {
							wasInserted: false,
							status: "upserted" as const,
							entityId: `entity-${item.externalId}`,
						};
					}
					if (options?.maximumTotal !== undefined && entities.size >= options.maximumTotal) {
						return { status: "skipped" as const };
					}
					entities.add(item.externalId);
					return {
						wasInserted: true,
						status: "upserted" as const,
						entityId: `entity-${item.externalId}`,
					};
				}),
			);
		},
	});
	return { calls, host };
};

describe("fitness exercise preload cron", () => {
	it("batch upserts normalized exercises and remains idempotent", async () => {
		const { calls, host } = makeHost([exercise], 1);

		const first = await Effect.runPromise(cron.run(null, host, execution));
		const second = await Effect.runPromise(cron.run(null, host, execution));

		expect(first).toEqual({ inserted: 1, processed: 1 });
		expect(second).toEqual({ inserted: 0, processed: 1 });
		expect(calls).toHaveLength(2);
		expect(calls[0]?.items).toEqual([
			expect.objectContaining({
				name: "Bench Press",
				externalId: "Bench Press",
				entitySchemaSlug: "exercise",
				properties: {
					images: [],
					force: "push",
					level: "beginner",
					mechanic: "compound",
					equipment: "barbell",
					kind: "reps_and_weight",
					muscles: ["chest", "triceps"],
					instructions: ["Push the bar up."],
				},
			}),
		]);
		expect(calls[0]?.options).toEqual({ maximumTotal: 1 });
		expect(calls[0]?.items[0]?.populatedAt).toEqual(expect.any(String));
	});

	it("does not preload exercises when configured to zero", async () => {
		const { calls, host } = makeHost([exercise], 0);

		const result = await Effect.runPromise(cron.run(null, host, execution));

		expect(result).toEqual({ inserted: 0, processed: 0 });
		expect(calls).toEqual([]);
	});

	it("honors a bounded preload limit and writes bounded batches", async () => {
		const dataset = Array.from({ length: 101 }, (_, index) => ({
			...exercise,
			name: `Exercise ${String(index).padStart(3, "0")}`,
		}));
		const { calls, host } = makeHost(dataset, 101);

		const result = await Effect.runPromise(cron.run(null, host, execution));

		expect(result).toEqual({ inserted: 101, processed: 101 });
		expect(calls.map(({ items }) => items.length)).toEqual([100, 1]);
		expect(calls.map(({ options }) => options)).toEqual([
			{ maximumTotal: 101 },
			{ maximumTotal: 101 },
		]);
	});

	it("counts the whole catalog when reordered exercises move outside the preload prefix", async () => {
		const dataset = [
			{ ...exercise, name: "New Prefix Exercise" },
			{ ...exercise, name: "Another Prefix Exercise" },
		];
		const { calls, host } = makeHost(dataset, 2, ["Former Prefix Exercise"]);

		const result = await Effect.runPromise(cron.run(null, host, execution));

		expect(result).toEqual({ inserted: 1, processed: 2 });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.options).toEqual({ maximumTotal: 2 });
	});

	it("caps an over-limit preload at 873 exercises", async () => {
		const dataset = Array.from({ length: 874 }, (_, index) => ({
			...exercise,
			name: `Exercise ${String(index).padStart(3, "0")}`,
		}));
		const { calls, host } = makeHost(dataset, 1_000);

		const result = await Effect.runPromise(cron.run(null, host, execution));

		expect(result).toEqual({ inserted: 873, processed: 873 });
		expect(calls.map(({ items }) => items.length)).toEqual([
			100, 100, 100, 100, 100, 100, 100, 100, 73,
		]);
	});
});
