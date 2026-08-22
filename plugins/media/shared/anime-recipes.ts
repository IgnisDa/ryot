import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	ascending,
	castDate,
	castNumber,
	column,
	defineRecipe,
	gt,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	selectedField,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/plugin-kit/ryotql";

import { AiringScheduleListSchema } from "./anime";
import {
	entityIdentitySelection,
	entitySchema,
	propertyJson,
	propertyNumber,
} from "./entity-selections";
import { mediaEntityCountMeasure, mediaFlatRecipes, mediaNumberSelection } from "./media-recipes";

export const animeAiringSoonRecipe = defineRecipe(
	(input: {
		readonly now: string;
		readonly after?: string | undefined;
		readonly limit?: number;
	}) => {
		const entity = table("entity", "entity");
		const schedule = jsonPath(column(entity, "properties"), "airingSchedule");
		const airingAt = castDate(jsonPath(jsonElement(), "airingAt"));
		const episode = castNumber(jsonPath(jsonElement(), "episode"));
		const upcoming = gt(airingAt, castDate(literal(input.now)));
		const nextAiringAt = jsonArrayFirst(schedule, {
			where: upcoming,
			select: airingAt,
			orderBy: [ascending(airingAt)],
		});
		const nextEpisode = jsonArrayFirst(schedule, {
			select: episode,
			where: upcoming,
			orderBy: [ascending(airingAt)],
		});
		return {
			map: ({ anime }) => Result.succeed(anime),
			queries: {
				anime: selectedRows(entity, {
					after: input.after,
					limit: input.limit,
					orderBy: [ascending(nextAiringAt)],
					where: and(entitySchema(entity, "anime"), jsonArrayExists(schedule, upcoming)),
					selection: {
						...entityIdentitySelection(entity),
						nextEpisode: selectedField(nextEpisode, Schema.Number),
						nextAiringAt: selectedField(nextAiringAt, Schema.String),
					},
				}),
			},
		};
	},
);

export type AnimeAiringSoonResult = Recipe.Success<typeof animeAiringSoonRecipe>;

export const animeRecipes = mediaFlatRecipes({
	slug: "anime",
	alias: "anime",
	measure: mediaEntityCountMeasure("episodes"),
	presentationFields: mediaNumberSelection("episodes"),
	activityEventFields: (event) => ({
		animeEpisode: selectedField(
			propertyNumber(event, "animeEpisode"),
			Schema.NullOr(Schema.Number),
		),
	}),
	summaryFields: (entity) => ({
		...mediaNumberSelection("episodes")(entity),
		airingSchedule: selectedField(propertyJson(entity, "airingSchedule"), AiringScheduleListSchema),
	}),
});
