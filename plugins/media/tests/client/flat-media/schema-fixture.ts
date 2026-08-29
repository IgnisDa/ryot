import { mediaActivityTimeLabel } from "../../../client/media/activity-timeline";
import { defineFlatMediaSchema } from "../../../client/media/flat-schema";
import { MEDIA_ART_HEIGHT } from "../../../client/media/hero";
import {
	flatFixtureRecipes,
	flatUngroupedFixtureRecipes,
	type UngroupedFixtureActivityEvent,
} from "./recipes";

type UngroupedProgressPosition = Pick<
	Extract<UngroupedFixtureActivityEvent, { readonly kind: "media" }>,
	"fixtureChapter"
>;

export const fixtureSchema = defineFlatMediaSchema({
	aspect: "poster",
	recipes: flatFixtureRecipes,
	presentationFacts: () => [],
	heroHeight: () => MEDIA_ART_HEIGHT,
	overviewLoadingDetail: "Fetching the credits for this item.",
	nouns: { plural: "items", title: "Fixture", singular: "item" },
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	facts: () => [{ value: "3", icon: "hash", label: "Fixture count" }],
	group: { actionLabel: "View group", title: (name) => `Part of ${name}` },
	creditCopy: { people: "People", notice: "Credits", companies: "Companies" },
	activityCopy: {
		segmentNoun: "Pass",
		progressVerb: "done",
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

export const ungroupedFixtureSchema = defineFlatMediaSchema({
	facts: () => [],
	aspect: "poster",
	presentationFacts: () => [],
	heroHeight: () => MEDIA_ART_HEIGHT,
	recipes: flatUngroupedFixtureRecipes,
	overviewLoadingDetail: "Fetching the credits for this item.",
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	nouns: { plural: "items", singular: "item", title: "Ungrouped" },
	creditCopy: { people: "People", notice: "Credits", companies: "Companies" },
	activityCopy: {
		segmentNoun: "Pass",
		progressVerb: "done",
		recordLabel: "Item record",
		completionsLabel: "Passes",
		loadingDetail: "Fetching the item record.",
		emptyDetail: "Nothing has been recorded for this item.",
		beats: { dropped: "Stopped the item", on_hold: "Put this item on hold" },
		rowLabels: {
			review: "Reviewed the item",
			completion: "Finished the item",
			progress: (percent: string | undefined, position: UngroupedProgressPosition) =>
				position.fixtureChapter === null
					? `${percent ?? "Some"}% through the item`
					: `Chapter ${position.fixtureChapter}`,
		},
	},
});
