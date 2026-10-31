import { assert, expect, it } from "@effect/vitest";
import { driveWorkflowReplay } from "@ryot-app/plugin-backend-sdk/testing";
import { Effect } from "effect";

import workflow from "./media-trending.sandbox";

type Fetch = { status: "failed" } | { status: "fetched"; entityIds: string[] };

const run = (movie: Fetch, show: Fetch = { status: "fetched", entityIds: ["show-a"] }) => {
	const replies: Record<string, Fetch> = { "fetch-show": show, "fetch-movie": movie };
	return driveWorkflowReplay(workflow.run, {}, (request) => {
		if (request.kind !== "activity") {
			return null;
		}
		return replies[request.name] ?? { synced: true, itemCount: 2 };
	});
};

it.live("fetches each provider then ranks the fetched batches", () =>
	Effect.gen(function* () {
		const result = yield* run({ status: "fetched", entityIds: ["movie-a"] });
		assert(result.state === "completed");
		expect(result.output).toEqual({ synced: true, itemCount: 2, providerCount: 2 });
		expect(
			result.requests.flatMap((request) =>
				request.kind === "activity"
					? [{ name: request.name, input: request.args.input, scriptSlug: request.args.scriptSlug }]
					: [],
			),
		).toEqual([
			{ input: {}, name: "fetch-movie", scriptSlug: "movie.tmdb.trending" },
			{ input: {}, name: "fetch-show", scriptSlug: "show.tmdb.trending" },
			{
				name: "rank",
				scriptSlug: "media-trending-rankings",
				input: {
					failedEntitySchemaSlugs: [],
					batches: [
						{ entityIds: ["movie-a"], entitySchemaSlug: "movie" },
						{ entityIds: ["show-a"], entitySchemaSlug: "show" },
					],
				},
			},
		]);
	}),
);

it.live("ranks only the batches of providers that fetched", () =>
	Effect.gen(function* () {
		const result = yield* run({ status: "failed" });
		assert(result.state === "completed");
		expect(result.output).toEqual({ synced: true, itemCount: 2, providerCount: 1 });
		const rank = result.requests.find(
			(request) => request.kind === "activity" && request.name === "rank",
		);
		assert(rank?.kind === "activity");
		expect(rank.args.input).toEqual({
			failedEntitySchemaSlugs: ["movie"],
			batches: [{ entityIds: ["show-a"], entitySchemaSlug: "show" }],
		});
	}),
);

it.live("preserves the failed show schema by passing only the movie batch", () =>
	Effect.gen(function* () {
		const result = yield* run({ status: "fetched", entityIds: ["movie-a"] }, { status: "failed" });
		assert(result.state === "completed");
		expect(result.output).toEqual({ synced: true, itemCount: 2, providerCount: 1 });
		const rank = result.requests.find(
			(request) => request.kind === "activity" && request.name === "rank",
		);
		assert(rank?.kind === "activity");
		expect(rank.args.input).toEqual({
			failedEntitySchemaSlugs: ["show"],
			batches: [{ entityIds: ["movie-a"], entitySchemaSlug: "movie" }],
		});
	}),
);
