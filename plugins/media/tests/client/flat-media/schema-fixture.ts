import { mediaActivityTimeLabel } from "../../../client/media/activity-timeline";
import { defineFlatMediaSchema } from "../../../client/media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../../../client/media/hero";
import { flatFixtureRecipes } from "./recipes";

export const fixtureSchema = defineFlatMediaSchema({
	facts: () => [],
	aspect: "poster",
	progressVerb: "done",
	recipes: flatFixtureRecipes,
	presentationFacts: () => [],
	heroHeight: () => MEDIA_ART_HEIGHT,
	overviewLoadingDetail: "Fetching the credits for this item.",
	nouns: { plural: "items", title: "Fixture", singular: "item" },
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	group: { actionLabel: "View group", title: (name) => `Part of ${name}` },
	creditCopy: { people: "People", notice: "Credits", companies: "Companies" },
	activityCopy: {
		segmentNoun: "Pass",
		recordLabel: "Item record",
		completionsLabel: "Passes",
		loadingDetail: "Fetching the item record.",
		emptyDetail: "Nothing has been recorded for this item.",
		beats: { dropped: "Stopped the item", on_hold: "Put this item on hold" },
		rowLabels: {
			review: "Reviewed the item",
			completion: "Finished the item",
			progress: (percent) =>
				percent === undefined ? "Part-way through the item" : `${percent}% through the item`,
		},
	},
});
