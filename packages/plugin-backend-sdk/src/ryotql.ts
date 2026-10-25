import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/ryotql";

export * from "@ryot-app/ryotql";
export { JsonValue } from "@ryot-app/contract/schema/json";
export { IsoDateString } from "@ryot-app/ryotql-recipes/codecs";
export { withinPeriod } from "@ryot-app/ryotql-recipes/periods";
export type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
export { userMediaLibraryRecipe } from "@ryot-app/ryotql-recipes/user-media-library";
export {
	eventReadRecipe,
	entityReadRecipe,
	type EventReadResult,
	type EntityReadResult,
} from "@ryot-app/ryotql-recipes/scripts";
export {
	eventIsAfter,
	latestEventField,
	eventOrderAscending,
	eventOrderDescending,
} from "@ryot-app/ryotql-recipes/event-expressions";
export {
	ProjectionProcessing,
	projectionProcessing,
	projectionStatusMeasures,
	projectionProcessingState,
} from "@ryot-app/ryotql-recipes/projection-status";

export class RyotqlRecipeDecodeError extends Schema.TaggedError<
	RyotqlRecipeDecodeError,
	{ readonly brand: unique symbol }
>()("RyotqlRecipeDecodeError", { message: Schema.String }) {}

export const executeRyotqlRecipe = <Success, Error, Requirements>(
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, Error, Requirements>,
	recipe: PreparedRecipe<Success>,
) =>
	executeRyotql(recipe.document).pipe(
		Effect.flatMap((response) => {
			const decoded = recipe.decode(response);
			return decoded._tag === "Failure"
				? Effect.fail(
						new RyotqlRecipeDecodeError({
							message:
								decoded.failure instanceof Error
									? decoded.failure.message
									: "RyotQL recipe response is malformed",
						}),
					)
				: Effect.succeed(decoded.success);
		}),
	);

export class RyotqlPaginationError extends Schema.TaggedError<
	RyotqlPaginationError,
	{ readonly brand: unique symbol }
>()("RyotqlPaginationError", { message: Schema.String }) {}

/** The cursor for the next page, or undefined on the last page; fails when a page would not advance. */
export const continuationCursor = Effect.fnUntraced(function* (
	pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string },
	previous?: string,
) {
	if (!pageInfo.hasMore) {
		return undefined;
	}
	const cursor = pageInfo.nextCursor;
	if (cursor === null || cursor === "" || cursor === previous) {
		return yield* new RyotqlPaginationError({ message: "RyotQL pagination did not advance" });
	}
	return cursor;
});

export const readAllRyotqlPages = <Item, Error, Requirements>(
	loadPage: (
		after: string | undefined,
	) => Effect.Effect<
		{
			readonly items: ReadonlyArray<Item>;
			readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: null | string };
		},
		Error,
		Requirements
	>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		do {
			const page = yield* loadPage(after);
			items.push(...page.items);
			after = yield* continuationCursor(page.pageInfo).pipe(Effect.orDie);
			if (after !== undefined) {
				if (cursors.has(after)) {
					return yield* Effect.die("RyotQL pagination did not advance");
				}
				cursors.add(after);
			}
		} while (after !== undefined);
		return items;
	});
