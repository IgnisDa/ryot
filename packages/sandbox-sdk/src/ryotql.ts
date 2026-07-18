import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect } from "@ryot-app/sandbox-sdk/effect";

export * from "@ryot-app/ryotql";
export type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
export {
	entityReadRecipe,
	eventReadRecipe,
	type EntityReadResult,
	type EventReadResult,
} from "@ryot-app/ryotql-recipes/sandbox";
export { userLibraryRecipe } from "@ryot-app/ryotql-recipes/user-library";
export {
	eventIsAfter,
	eventOrderDescending,
	latestEventField,
} from "@ryot-app/ryotql-recipes/events";

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
