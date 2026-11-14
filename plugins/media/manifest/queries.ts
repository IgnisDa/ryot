import { reportingParameterFields, reportingPeriodPredicate } from "@ryot-app/plugin-kit/ryotql";
import {
	and,
	column,
	eq,
	exists,
	inArray,
	literal,
	schemaOwnerPredicate,
	table,
} from "@ryot-app/ryotql";
import { parameters } from "@ryot-app/ryotql/authoring";

import { mediaActivityRecipe } from "../shared/activity-recipes";
import {
	mediaAnalyticsRankingRecipe,
	mediaAnalyticsSummaryRecipe,
	mediaAnalyticsTrendRecipe,
} from "../shared/analytics-recipes";
import {
	episodicEpisodeEventsQuery,
	episodicSeasonReviewEventsQuery,
} from "../shared/episodic-recipes";
import { historyCategory, mediaEventHistoryRecipe } from "../shared/history-recipes";
import { podcastEpisodicKindConfig, showEpisodicKindConfig } from "../shared/lifecycle-expressions";
import { libraryByLifecycleStateRecipe } from "../shared/lifecycle-list-recipes";
import {
	creditCharacterSelection,
	mediaCollectionEventsQuery,
	mediaEntityEventsQuery,
	mediaFlatActivityParentSlugs,
	mediaPeopleRecipe,
	mediaReviewActivityEventSelection,
	mediaReviewActivityRecipe,
} from "../shared/media-recipes";
import { builtinMediaEntitySchemaSlugs } from "../shared/media-schema-slugs";
import { mediaEntityParameters } from "../shared/query-parameters";
import { upcomingRecipe } from "../shared/upcoming-recipes";

const reference = { kind: "self" } as const;
const historyInput = { reference, limit: 100, entityId: mediaEntityParameters.value("entityId") };
const history = mediaEventHistoryRecipe<unknown>([
	historyCategory(
		mediaEntityEventsQuery({
			...historyInput,
			alias: "titleHistory",
			slugs: mediaFlatActivityParentSlugs,
			selection: mediaReviewActivityEventSelection,
		}),
		(row) => row,
	),
	historyCategory(mediaCollectionEventsQuery(historyInput), (row) => row),
	...[showEpisodicKindConfig, podcastEpisodicKindConfig].map((config) =>
		historyCategory(
			episodicEpisodeEventsQuery({
				...historyInput,
				config,
				history: true,
				episodeFields: () => ({}),
				alias: `${config.kind}EpisodeHistory`,
			}),
			(row) => row,
		),
	),
	historyCategory(
		episodicSeasonReviewEventsQuery({ ...historyInput, alias: "titleSeasonHistory" }),
		(row) => row,
	),
]);
const people = mediaPeopleRecipe({
	slug: builtinMediaEntitySchemaSlugs,
	personFields: creditCharacterSelection,
})({ reference });
const reviews = mediaReviewActivityRecipe({ slug: "movie", alias: "reviews" })({ reference })
	.document.queries.events;
if (reviews?.output.type !== "rows") {
	throw new Error("Review recipe must declare an event rows query");
}
const reviewParameters = parameters({
	fields: {
		...reportingParameterFields,
		mediaTypes: {
			type: "enum-array",
			label: "Media types",
			description: "Restrict reviews to these types of media",
			choices: {
				kind: "static",
				values: builtinMediaEntitySchemaSlugs.map((value) => ({ value })),
			},
		},
	},
});
const entity = table("entity", "reviewTitle"),
	event = table("event", reviews.from.alias);

export const mediaDeclaredQueries = {
	"analytics-trend": {
		title: "Read media trend",
		document: mediaAnalyticsTrendRecipe({ reference }).document,
		description:
			"Group dated media consumption by reporting calendar day, week, month, or year for the selected and comparison periods, optionally restricted to a title or media type.",
	},
	"library-by-state": {
		title: "Find library titles by state",
		document: libraryByLifecycleStateRecipe(reference).document,
		description:
			"Find titles saved in your media library by lifecycle states and optional media types. Flat titles, shows, and podcasts have separate cursor pages named flat, show, and podcast.",
	},
	"activity-history": {
		title: "Summarize media activity",
		document: mediaActivityRecipe(reference).document,
		description:
			"Summarize dated media activity over a reporting period, including completions, recorded minutes, active days, reviews, and media-type shares. Episode contributions count toward their parent title.",
	},
	"analytics-ranking": {
		title: "Rank titles",
		document: mediaAnalyticsRankingRecipe({ reference }).document,
		description:
			"Rank titles by active observations, title completions, or episode completions within the selected reporting period. Optionally restrict by title or media type and page ranking for additional titles.",
	},
	upcoming: {
		title: "Find upcoming releases",
		document: upcomingRecipe({ reference }).document,
		description:
			"Find upcoming episodes, anime airings, and monitored title releases from today through daysAhead in the account's reporting time zone. Each title includes its upcoming occurrences and total occurrences in the window.",
	},
	"analytics-summary": {
		title: "Compare media periods",
		document: mediaAnalyticsSummaryRecipe({ reference }).document,
		description:
			"Compare media consumption and reviews across selected reporting periods. Totals distinguish recorded, estimated, missing, and superseded measurements, and include processing state and undated activity.",
	},
	"title-history": {
		title: "Read title history",
		document: {
			parameters: history.parameters,
			queries: { ...history.document.queries, ...people.document.queries },
		},
		description:
			"Read a title's complete media and collection history in global event order, together with its credited people. Bind entityId to the title ID; page history and people independently.",
	},
	reviews: {
		title: "Read reviews",
		description:
			"Read reviews of media titles over a reporting period, optionally restricted to media types. Results include ratings, review text, spoiler markers, and original event properties. Page the reviews query to read older reviews.",
		document: {
			parameters: reviewParameters.schema,
			queries: {
				reviews: {
					...reviews,
					output: { ...reviews.output, pagination: { limit: 60, maxLimit: 100 } },
					where: and(
						schemaOwnerPredicate(event, "eventSchemaPluginId", reference),
						eq(column(event, "eventSchemaSlug"), literal("review")),
						reportingPeriodPredicate(column(event, "occurredAt")),
						exists(entity, {
							where: and(
								eq(column(entity, "id"), column(event, "entityId")),
								schemaOwnerPredicate(entity, "entitySchemaPluginId", reference),
								inArray(
									column(entity, "entitySchemaSlug"),
									builtinMediaEntitySchemaSlugs.map(literal),
								),
								reviewParameters.whenSet(
									"mediaTypes",
									inArray(column(entity, "entitySchemaSlug"), reviewParameters.list("mediaTypes")),
								),
							),
						}),
					),
				},
			},
		},
	},
};
