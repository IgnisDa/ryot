import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";

import { genreDetails, genreResolve, genreSearch } from "./shared";

it.effect("reconstructs unknown genre names and resolves aliases locally", () =>
	Effect.gen(function* () {
		expect(yield* genreDetails({ externalId: "alternative rock" })).toEqual({
			properties: {},
			name: "Alternative Rock",
		});
		expect(yield* genreResolve({ value: "Sci-Fi", identifierType: "name" })).toEqual({
			externalId: "science fiction",
		});
		expect(yield* Effect.flip(genreDetails({ externalId: "Sci-Fi" }))).toMatchObject({
			message: "Invalid genre identity",
		});
	}),
);

it.effect("searches aliases and pages the built-in catalog", () =>
	Effect.gen(function* () {
		const result = yield* genreSearch({ page: 1, pageSize: 10, query: "sci-fi" });
		expect(result.items).toEqual([{ title: "Science Fiction", externalId: "science fiction" }]);
		const first = yield* genreSearch({ page: 1, query: "", pageSize: 2 });
		expect(first.items).toHaveLength(2);
		expect(first.details.nextPage).toBe(2);
	}),
);
