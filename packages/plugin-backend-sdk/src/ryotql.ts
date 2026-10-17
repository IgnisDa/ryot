import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { PreparedRecipe } from "@ryot-app/ryotql";

export * from "@ryot-app/ryotql";
export type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
export { JsonValue } from "@ryot-app/contract/schema/json";
export {
	entityReadRecipe,
	eventReadRecipe,
	type EntityReadResult,
	type EventReadResult,
} from "@ryot-app/ryotql-recipes/scripts";
export { userMediaLibraryRecipe } from "@ryot-app/ryotql-recipes/user-media-library";
export { IsoDateString } from "@ryot-app/ryotql-recipes/codecs";
export {
	eventIsAfter,
	eventOrderAscending,
	eventOrderDescending,
	latestEventField,
} from "@ryot-app/ryotql-recipes/event-expressions";

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

export const readAllRyotqlPages = <Item, Error, Requirements>(
	loadPage: (
		after: string | undefined,
	) => Effect.Effect<
		{
			readonly items: ReadonlyArray<Item>;
			readonly pageInfo: { readonly hasMore: boolean; readonly nextCursor: string | null };
		},
		Error,
		Requirements
	>,
) =>
	Effect.gen(function* () {
		const items: Item[] = [];
		const cursors = new Set<string>();
		let after: string | undefined;
		let hasMore = true;
		while (hasMore) {
			const page = yield* loadPage(after);
			items.push(...page.items);
			hasMore = page.pageInfo.hasMore;
			if (hasMore) {
				const cursor = page.pageInfo.nextCursor;
				if (cursor === null || cursor === "" || cursors.has(cursor)) {
					return yield* Effect.die("RyotQL pagination did not advance");
				}
				cursors.add(cursor);
				after = cursor;
			}
		}
		return items;
	});
