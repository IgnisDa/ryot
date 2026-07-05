import type { JsonValue, SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import { assert, describe, expect, it } from "vitest";

import { details, manifest, search } from "./free-exercise-db.sandbox";

type ExerciseHost = SandboxHost<typeof manifest.capabilities>;

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

	const host: ExerciseHost = defineSandboxTestHost(manifest, {
		httpCall: () => {
			httpCallCount += 1;
			return httpSuccess(httpBody);
		},
		getCachedValue: (key) => Effect.succeed(cache.get(key) ?? null),
		setCachedValue: (key, value, ttlSeconds) => {
			setCalls.push({ key, value, ttlSeconds });
			cache.set(key, value);
			return Effect.succeed(null);
		},
	});

	return { host, setCalls, httpCallCount: () => httpCallCount };
};

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("exercise.free-exercise-db sandbox script", () => {
	it("fetches, normalizes and writes chunk + metadata cache entries on a cache miss", () => {
		const { host, setCalls, httpCallCount } = makeStatefulHost();

		return Effect.runPromise(
			search.run({ query: "bench", page: 1, pageSize: 20 }, host, execution),
		).then((result) => {
			expect(httpCallCount()).toBe(1);
			expect(result.items).toEqual([
				{
					externalId: "Bench Press",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Bench Press" },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: {
						kind: "image",
						value: { type: "remote", url: `${IMAGES_PREFIX_URL}/Bench_Press/0.jpg` },
					},
				},
			]);
			expect(result.details).toEqual({ totalItems: 1, nextPage: null });

			const metadataCall = setCalls.find((call) => call.key === CACHE_KEY);
			assert(metadataCall !== undefined);
			const metadata = metadataCall.value;
			assertJsonRecord(metadata);
			expect(metadataCall.ttlSeconds).toBe(86400);
			expect(metadata["chunkCount"]).toBe(1);
			const version = metadata["version"];
			assert(typeof version === "string");

			const chunkKeys = setCalls.map((call) => call.key).filter((key) => key !== CACHE_KEY);
			expect(chunkKeys).toEqual([`${CACHE_KEY}:${version}:chunk:0`]);
			return undefined;
		});
	});

	it("maps normalized properties through the details driver on a cache miss", () => {
		const { host } = makeStatefulHost();

		return Effect.runPromise(details.run({ externalId: "Bench Press" }, host, execution)).then(
			(result) => {
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
				return undefined;
			},
		);
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
			[CACHE_KEY]: { version: "v-test", chunkCount: 1 },
			[`${CACHE_KEY}:v-test:chunk:0`]: [seededRow],
		});

		return Effect.runPromise(
			search.run({ query: "bench", page: 1, pageSize: 20 }, host, execution),
		).then((result) => {
			expect(httpCallCount()).toBe(0);
			expect(result.items).toEqual([
				{
					externalId: "Bench Press",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Bench Press" },
					primarySubtitleProperty: { kind: "null", value: null },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: {
						kind: "image",
						value: { type: "remote", url: `${IMAGES_PREFIX_URL}/Bench_Press/0.jpg` },
					},
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
