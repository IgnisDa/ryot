import { RyotQLResponse } from "@ryot-app/contract/modules/ryotql/language";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { recipeResponse } from "@ryot-app/ryotql-recipes/test-utils";
import { Result, Schema } from "effect";

import {
	fitnessAnalyticsTrendRecipe,
	historicalFitnessRankingRecipe,
} from "../../shared/analytics-recipes";

const validResponse = (value: unknown) =>
	Result.getOrThrow(Schema.decodeUnknownResult(RyotQLResponse)(value));

const reference = { kind: "self" } as const;
export const rankingResponse = (
	nextCursor: null | string,
	items: readonly Readonly<Record<string, JsonValue>>[] = [],
	kind: "targets" | "equipment" | "exercises" = "targets",
) =>
	validResponse(
		recipeResponse(historicalFitnessRankingRecipe({ reference }), {
			[kind]: {
				items,
				type: "aggregate",
				pageInfo: { limit: 100, nextCursor, hasMore: nextCursor !== null },
			},
		}),
	);
export const analyticsTrendResponse = (
	items: readonly Readonly<Record<string, JsonValue>>[],
	key: "setTrend" | "workoutTrend" | "derivedTrend" = "workoutTrend",
) =>
	validResponse(
		recipeResponse(fitnessAnalyticsTrendRecipe({ reference }), {
			[key]: {
				items,
				type: "aggregate",
				pageInfo: { limit: 366, hasMore: false, nextCursor: null },
			},
		}),
	);
