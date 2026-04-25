import type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
import type { PreparedRecipe } from "@ryot/ryotql";
import { Effect } from "@ryot/sandbox-sdk/effect";

export * from "@ryot/ryotql";
export type { RyotQLDocument } from "@ryot/contract/modules/ryotql/language";
export {
	entityReadRecipe,
	eventReadRecipe,
	type EntityReadResult,
	type EventReadResult,
} from "@ryot/ryotql-recipes/sandbox";
export { userLibraryRecipe } from "@ryot/ryotql-recipes/user-library";
export { eventIsAfter, eventOrderDescending, latestEventField } from "@ryot/ryotql-recipes/events";

export const executeRyotqlRecipe = <Success, Error, Requirements>(
	executeRyotql: (document: RyotQLDocument) => Effect.Effect<unknown, Error, Requirements>,
	recipe: PreparedRecipe<Success>,
) =>
	executeRyotql(recipe.document).pipe(
		Effect.flatMap((response) => {
			const decoded = recipe.decode(response);
			return decoded._tag === "Failure"
				? Effect.fail(decoded.failure)
				: Effect.succeed(decoded.success);
		}),
	);
