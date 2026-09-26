import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxHost } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { assert, describe, expect, it } from "vitest";

import details, { manifest as detailsManifest } from "./details.sandbox";
import resolve, { manifest as resolveManifest } from "./resolve.sandbox";
import search, { manifest as searchManifest } from "./search.sandbox";

type ExerciseHost = SandboxHost<typeof searchManifest.capabilities>;

const CACHE_KEY = "free-exercise-db:normalized:v1";
const IMAGES_PREFIX_URL =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";

const dataset = [
	{
		images: [],
		force: "pull",
		name: "Ab Crunch",
		category: "strength",
		secondaryMuscles: [],
		level: "intermediate",
		mechanic: "isolation",
		equipment: "body only",
		instructions: ["Crunch up."],
		primaryMuscles: ["abdominals"],
	},
	{
		force: "push",
		level: "beginner",
		name: "Bench Press",
		category: "strength",
		mechanic: "compound",
		equipment: "barbell",
		primaryMuscles: ["chest"],
		images: ["Bench_Press/0.jpg"],
		secondaryMuscles: ["triceps"],
		instructions: ["Lie down.", "Push the bar up."],
	},
];

const httpSuccess = (body: unknown) =>
	Effect.succeed({ status: 200, headers: {}, body: JSON.stringify(body) });

type SetCall = { key: string; value: JsonValue; ttlSeconds: number };

const makeStatefulHost = (
	initialCache: Record<string, JsonValue> = {},
	httpBody: unknown = dataset,
) => {
	const cache = new Map<string, JsonValue>(Object.entries(initialCache));
	const setCalls: SetCall[] = [];
	let httpCallCount = 0;

	const host: ExerciseHost = defineSandboxTestHost(searchManifest, {
		getCachedValue: (key) => Effect.succeed(cache.get(key) ?? null),
		httpCall: (_method, url) => {
			expect(new URL(url).host).toBe("raw.githubusercontent.com");
			httpCallCount += 1;
			return httpSuccess(httpBody);
		},
		setCachedValue: (key, value, ttlSeconds) => {
			setCalls.push({ key, value, ttlSeconds });
			cache.set(key, value);
			return Effect.succeed(null);
		},
	});

	return { host, setCalls, httpCallCount: () => httpCallCount };
};

const execution = {
	metadata: {},
	sandboxScriptId: "script_test",
	startedAt: "2026-08-06T00:00:00.000Z",
};

describe("exercise.free-exercise-db sandbox script", () => {
	it("uses matching narrow capabilities for all provider operations", () => {
		expect(searchManifest.capabilities).toEqual(["httpCall", "getCachedValue", "setCachedValue"]);
		expect(detailsManifest.capabilities).toEqual(searchManifest.capabilities);
		expect(resolveManifest.capabilities).toEqual(searchManifest.capabilities);
		expect(searchManifest.requiredPluginConfigKeys).toEqual([]);
		expect(detailsManifest.requiredPluginConfigKeys).toEqual([]);
		expect(resolveManifest.requiredPluginConfigKeys).toEqual([]);
	});

	it("fetches, normalizes and writes chunk + metadata cache entries on a cache miss", () => {
		const { host, setCalls, httpCallCount } = makeStatefulHost();

		return Effect.runPromise(
			search.run({ page: 1, pageSize: 20, query: "bench" }, host, execution),
		).then((result) => {
			expect(httpCallCount()).toBe(1);
			expect(result.items).toEqual([
				{
					title: "Bench Press",
					externalId: "Bench Press",
					imageUrl: `${IMAGES_PREFIX_URL}/Bench_Press/0.jpg`,
				},
			]);
			expect(result.details).toEqual({ totalItems: 1, nextPage: null });

			const metadataCall = setCalls.find((call) => call.key === CACHE_KEY);
			assert(metadataCall !== undefined);
			const metadata = metadataCall.value;
			assertJsonRecord(metadata);
			expect(metadataCall.ttlSeconds).toBe(86400);
			expect(metadata["chunkCount"]).toBe(1);
			expect(metadata["version"]).toBe(execution.startedAt);

			const chunkKeys = setCalls.map((call) => call.key).filter((key) => key !== CACHE_KEY);
			expect(chunkKeys).toEqual([`${CACHE_KEY}:${execution.startedAt}:chunk:0`]);
			return undefined;
		});
	});

	it("omits absent image and metadata fields", () => {
		const { host } = makeStatefulHost();

		return Effect.runPromise(
			search.run({ page: 1, pageSize: 20, query: "crunch" }, host, execution),
		).then((result) => {
			expect(result.items).toEqual([{ title: "Ab Crunch", externalId: "Ab Crunch" }]);
			return undefined;
		});
	});

	it("shares the normalized cache between search and details entrypoints", async () => {
		const { host, httpCallCount } = makeStatefulHost();

		await Effect.runPromise(search.run({ page: 1, pageSize: 20, query: "bench" }, host, execution));
		const result = await Effect.runPromise(
			details.run({ externalId: "Bench Press" }, host, execution),
		);

		expect(httpCallCount()).toBe(1);
		expect(result.name).toBe("Bench Press");
		expect(result.properties).toEqual({
			force: "push",
			level: "beginner",
			mechanic: "compound",
			equipment: "barbell",
			kind: "reps_and_weight",
			muscles: ["chest", "triceps"],
			instructions: ["Lie down.", "Push the bar up."],
			images: [{ type: "remote", url: `${IMAGES_PREFIX_URL}/Bench_Press/0.jpg` }],
		});
	});

	it("resolves only one exact normalized exercise name to its canonical external id", async () => {
		const { host, httpCallCount } = makeStatefulHost();

		await expect(
			Effect.runPromise(
				resolve.run({ identifierType: "name", value: "  BENCH---press " }, host, execution),
			),
		).resolves.toEqual({ externalId: "Bench Press" });
		await expect(
			Effect.runPromise(resolve.run({ value: "Bench", identifierType: "name" }, host, execution)),
		).resolves.toEqual({ externalId: null });
		expect(httpCallCount()).toBe(1);
	});

	it("does not resolve ambiguous normalized names or unsupported identifiers", async () => {
		const { host } = makeStatefulHost({}, [...dataset, { ...dataset[1], name: "Bench-Press" }]);

		await expect(
			Effect.runPromise(
				resolve.run({ value: "bench press", identifierType: "name" }, host, execution),
			),
		).resolves.toEqual({ externalId: null });
		await expect(
			Effect.runPromise(
				resolve.run({ value: "Bench Press", identifierType: "external-id" }, host, execution),
			),
		).resolves.toEqual({ externalId: null });
	});

	it("reads chunks from a pre-seeded cache without making an http call", () => {
		const seededRow = {
			name: "Bench Press",
			externalId: "Bench Press",
			searchText:
				"bench press reps and weight beginner strength push compound barbell chest triceps",
			properties: {
				force: "push",
				level: "beginner",
				mechanic: "compound",
				equipment: "barbell",
				kind: "reps_and_weight",
				muscles: ["chest", "triceps"],
				instructions: ["Lie down.", "Push the bar up."],
				images: [{ type: "remote", url: `${IMAGES_PREFIX_URL}/Bench_Press/0.jpg` }],
			},
		};
		const { host, httpCallCount } = makeStatefulHost({
			[`${CACHE_KEY}:v-test:chunk:0`]: [seededRow],
			[CACHE_KEY]: { chunkCount: 1, version: "v-test" },
		});

		return Effect.runPromise(
			search.run({ page: 1, pageSize: 20, query: "bench" }, host, execution),
		).then((result) => {
			expect(httpCallCount()).toBe(0);
			expect(result.items).toEqual([
				{
					title: "Bench Press",
					externalId: "Bench Press",
					imageUrl: `${IMAGES_PREFIX_URL}/Bench_Press/0.jpg`,
				},
			]);
			expect(result.details).toEqual({ totalItems: 1, nextPage: null });
			return undefined;
		});
	});
});

function assertJsonRecord(value: JsonValue): asserts value is Record<string, JsonValue> {
	assert(typeof value === "object" && value !== null && !Array.isArray(value));
}
