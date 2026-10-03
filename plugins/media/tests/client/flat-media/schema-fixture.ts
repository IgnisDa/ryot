import { mediaActivityTimeLabel } from "../../../client/media/activity-timeline";
import type { MediaPresentationSubject } from "../../../client/media/entity-presentation";
import { defineFlatMediaSchema, type MediaOverviewRail } from "../../../client/media/flat-schema";
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

const defineFixtureSchema = (overviewRails?: () => readonly MediaOverviewRail[]) =>
	defineFlatMediaSchema({
		...(overviewRails === undefined ? {} : { overviewRails }),
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
			libraryLabel: "Added to media library",
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

export const fixtureSchema = defineFixtureSchema();

export const railItem = (id: string, name: string): MediaPresentationSubject => ({
	id,
	name,
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "s3", purpose: "cover", key: `${id}-cover` }],
});

export const railedFixtureSchema = defineFixtureSchema(() => [
	{ key: "first", title: "First rail", items: [railItem("rail-1", "Alpha")] },
	{ items: [], key: "empty", title: "Empty rail" },
	{ key: "second", title: "Second rail", items: [railItem("rail-2", "Beta")] },
]);

export const ungroupedFixtureSchema = defineFlatMediaSchema({
	facts: () => [],
	aspect: "square",
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
		libraryLabel: "Added to media library",
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
