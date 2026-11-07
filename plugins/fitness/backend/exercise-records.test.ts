import { expect } from "bun:test";

import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { FoldInput } from "@ryot-app/plugin-backend-sdk/folds";
import type { RyotQLDocument } from "@ryot-app/plugin-backend-sdk/ryotql";
import { defineSandboxTestHost } from "@ryot-app/plugin-backend-sdk/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";

import definition, { manifest } from "./exercise-records.sandbox";

const workoutRecord = (id: string, weight: number) => ({
	id,
	weight,
	reps: 10,
	duration: null,
	distance: null,
	exerciseKind: "reps_and_weight",
});

const page = (
	items: ReadonlyArray<ReturnType<typeof workoutRecord>>,
	nextCursor: null | string,
) => ({
	items,
	type: "rows" as const,
	pageInfo: { nextCursor, limit: 100, hasMore: nextCursor !== null },
});

it.effect(
	"awards personal bests across every page of an exercise's sets in record order",
	() =>
		Effect.gen(function* () {
			const calls: RyotQLDocument[] = [];
			const pages = [
				page([workoutRecord("set-1", 25), workoutRecord("set-2", 20)], "next"),
				page([workoutRecord("set-3", 30)], null),
			];
			const host = defineSandboxTestHost(manifest, {
				executeRyotql: (document) =>
					Effect.sync(() => {
						const records = pages[calls.length];
						calls.push(document);
						return { data: { records } };
					}),
			});
			const input = yield* Schema.decodeEffect(FoldInput)({
				value: null,
				absorbed: [],
				subjectEntityId: "exercise-1",
			});
			const output = yield* definition.run(input, host);
			expect(output).toEqual<unknown>({
				value: null,
				changes: [],
				relationships: [],
				events: [
					{
						eventId: "set-1",
						properties: {
							volume: 250,
							oneRm: 33.333333,
							personalBests: ["reps", "one_rm", "volume", "weight"],
						},
					},
					{ eventId: "set-2", properties: { volume: 200, oneRm: 26.666667, personalBests: [] } },
					{
						eventId: "set-3",
						properties: { oneRm: 40, volume: 300, personalBests: ["one_rm", "volume", "weight"] },
					},
				],
			});
			expect(calls.map((document) => document.queries["records"]?.output)).toMatchObject([
				{ pagination: { limit: 100 } },
				{ pagination: { limit: 100, after: "next" } },
			]);
		}),
	testTimeout,
);
