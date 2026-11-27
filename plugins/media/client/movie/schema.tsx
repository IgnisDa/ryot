import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { movieRecipes } from "../../shared/movie-recipes";
import { originalLanguageFact } from "../../shared/original-language";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema } from "../media/flat-schema";
import { mediaWatchProvidersTrailing } from "../media/overview";
import {
	mediaDurationFact,
	mediaDurationLabels,
	type MediaSummaryFact,
} from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";

type MovieSummary = MediaSummaryOf<typeof movieRecipes>;

type MoviePresentation = MediaPresentationDataOf<typeof movieRecipes>;

export const movieSummaryFacts = (
	movie: MovieSummary,
	copy: MediaCopy,
): readonly MediaSummaryFact[] =>
	[
		...originalLanguageFact(copy.text("property.original-language"), movie.originalLanguage),
		mediaDurationFact(copy, movie.runtime, copy.text("property.runtime")),
	].filter((fact) => fact !== undefined);

export const moviePresentationFacts = (movie: MoviePresentation, { formatters }: MediaCopy) =>
	mediaDurationLabels(formatters, movie.runtime);

export const movieSchema = defineFlatMediaSchema({
	recipes: movieRecipes,
	facts: movieSummaryFacts,
	aspect: mediaSchemaAspects.movie,
	presentationFacts: moviePresentationFacts,
	overviewLoadingDetail: catalogMessage("overview.loading.movie"),
	group: { actionLabel: catalogMessage("group.view-collection") },
	overviewTrailing: mediaWatchProvidersTrailing((summary) => summary),
	activityCopy: (copy) => mediaFlatActivityCopy(copy, { verb: "watch", kind: "movie" }),
	measureFigure: { value: mediaActivityTimeLabel, label: catalogMessage("activity.figure-time") },
	logActivity: {
		family: "flat",
		progressUnit: { field: "runtime" },
		copy: { verb: "watch", kind: "movie" },
	},
	creditCopy: {
		people: catalogMessage("credits.cast-crew"),
		notice: catalogMessage("credits.notice.movie"),
		companies: catalogMessage("credits.production-companies"),
	},
});
