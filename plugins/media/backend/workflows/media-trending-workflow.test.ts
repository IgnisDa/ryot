import { expect } from "bun:test";

import { driveWorkflowReplay } from "@ryot-app/plugin-backend-sdk/testing";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import workflow from "./media-trending.sandbox";

type Fetch = { status: "failed" } | { status: "fetched"; itemCount: number };

const run = (movie: Fetch, show: Fetch = { itemCount: 3, status: "fetched" }) => {
	const replies: Record<string, Fetch> = { "fetch-show": show, "fetch-movie": movie };
	return driveWorkflowReplay(workflow.run, {}, (request) =>
		request.kind === "activity" ? (replies[request.name] ?? null) : null,
	);
};

it.live(
	"runs each provider's trending activity in turn and sums what they ranked",
	() =>
		Effect.gen(function* () {
			const result = yield* run({ itemCount: 2, status: "fetched" });
			assert(result.state === "completed");
			expect(result.output).toEqual({ synced: true, itemCount: 5, providerCount: 2 });
			expect(
				result.requests.flatMap((request) =>
					request.kind === "activity"
						? [
								{
									name: request.name,
									input: request.args.input,
									scriptSlug: request.args.scriptSlug,
								},
							]
						: [],
				),
			).toEqual([
				{ input: {}, name: "fetch-movie", scriptSlug: "movie.tmdb.trending" },
				{ input: {}, name: "fetch-show", scriptSlug: "show.tmdb.trending" },
			]);
		}),
	testTimeout,
);

it.live(
	"counts only the providers that fetched",
	() =>
		Effect.gen(function* () {
			const result = yield* run({ status: "failed" });
			assert(result.state === "completed");
			expect(result.output).toEqual({ synced: true, itemCount: 3, providerCount: 1 });
		}),
	testTimeout,
);

it.live(
	"reports nothing synced when every provider failed",
	() =>
		Effect.gen(function* () {
			const result = yield* run({ status: "failed" }, { status: "failed" });
			assert(result.state === "completed");
			expect(result.output).toEqual({ itemCount: 0, synced: false, providerCount: 0 });
		}),
	testTimeout,
);
