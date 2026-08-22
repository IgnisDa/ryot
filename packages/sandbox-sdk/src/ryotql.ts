import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { PreparedRecipe } from "@ryot-app/ryotql";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export * from "@ryot-app/ryotql";
export type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
export {
	entityReadRecipe,
	eventReadRecipe,
	type EntityReadResult,
	type EventReadResult,
} from "@ryot-app/ryotql-recipes/sandbox";
export { userMediaLibraryRecipe } from "@ryot-app/ryotql-recipes/user-media-library";
export { userFitnessLibraryRecipe } from "@ryot-app/ryotql-recipes/user-fitness-library";
export { IsoDateString } from "@ryot-app/ryotql-recipes/codecs";
export {
	eventIsAfter,
	eventOrderAscending,
	eventOrderDescending,
	latestEventField,
} from "@ryot-app/ryotql-recipes/event-expressions";

export class RyotqlRecipeDecodeError extends Schema.TaggedError<RyotqlRecipeDecodeError>()(
	"RyotqlRecipeDecodeError",
	{ message: Schema.String },
) {}

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
