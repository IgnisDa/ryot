import type { AuthoredAppSchema } from "@ryot-app/contract/modules/plugins/manifest-text";
import type { PluginExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import type { Recipe } from "@ryot-app/ryotql";

export * from "@ryot-app/ryotql";
export { JsonValue } from "@ryot-app/contract/schema/json";
export { IsoDateString } from "@ryot-app/ryotql-recipes/codecs";
export { withinPeriod } from "@ryot-app/ryotql-recipes/periods";
export { librarySearchQuery } from "@ryot-app/ryotql-recipes/library-search";
export { userMediaLibraryRecipe } from "@ryot-app/ryotql-recipes/user-media-library";
export { entityEventScopeRevisionRecipe } from "@ryot-app/ryotql-recipes/event-scope";
export type { PluginRyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
export type { PluginExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
export {
	now,
	sort,
	filter,
	dateAdd,
	parameters,
	aggregateSort,
	reportingTimeZone,
} from "@ryot-app/ryotql/authoring";
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
export {
	reportingWindow,
	reportingArguments,
	reportingParameters,
	type ReportingWindow,
	expressionDateWindow,
	reportingDatePredicate,
	reportingSincePredicate,
	reportingParameterFields,
	reportingPeriodPredicate,
	expressionPeriodPredicate,
	reportingGroupingExpression,
} from "@ryot-app/ryotql-recipes/reporting-parameters";

export class RyotqlRecipeDecodeError extends Schema.TaggedError<
	RyotqlRecipeDecodeError,
	{ readonly brand: unique symbol }
>()("RyotqlRecipeDecodeError", { message: Schema.String }) {}

export const executeRyotqlRecipe = <
	Success,
	Parameters extends AuthoredAppSchema,
	Error,
	Requirements,
>(
	executeRyotql: (request: PluginExecutionRequest) => Effect.Effect<unknown, Error, Requirements>,
	recipe: Recipe<Success, Parameters>,
	arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
	options: Omit<PluginExecutionRequest, "source" | "arguments"> = {},
) =>
	executeRyotql({
		...options,
		arguments: arguments_,
		source: {
			kind: "inline",
			document: recipe.document,
			...(recipe.query === undefined ? {} : { query: recipe.query }),
		},
	}).pipe(
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
