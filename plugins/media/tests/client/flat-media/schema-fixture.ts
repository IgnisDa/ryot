import { Text } from "@ryot-app/i18n/text";

import { mediaActivityTimeLabel } from "../../../client/media/activity-timeline";
import type { MediaSavedViewPresentationSubject } from "../../../client/media/entity-presentation";
import { defineFlatMediaSchema, type MediaOverviewRail } from "../../../client/media/flat-schema";
import { catalogMessage } from "../../../shared/messages.generated";
import {
	flatFixtureRecipes,
	flatUngroupedFixtureRecipes,
	type UngroupedFixtureActivityEvent,
} from "./recipes";

type UngroupedProgressPosition = Pick<
	Extract<UngroupedFixtureActivityEvent, { readonly kind: "media" }>,
	"fixtureChapter"
>;

const fixtureLogger = { family: "flat", copy: { verb: "watch", kind: "movie" } } as const;

const fixtureActivityCopy = {
	segment: "watch",
	completionsLabel: Text("Passes"),
	recordLabel: Text("Item record"),
	itemLabel: () => Text("Item consumed"),
	libraryLabel: Text("Added to media library"),
	loadingDetail: Text("Fetching the item record."),
	progressLabel: (percent: number) => Text(`${percent}% done`),
	snapshot: { label: Text("Synced"), detail: () => undefined },
	emptyDetail: Text("Nothing has been recorded for this item."),
	beats: { on_hold: Text("Put on hold"), dropped: Text("Stopped the item") },
	rowLabels: { review: Text("Reviewed the item"), completion: Text("Finished the item") },
} as const;

const defineFixtureSchema = (overviewRails?: () => readonly MediaOverviewRail[]) =>
	defineFlatMediaSchema({
		...(overviewRails === undefined ? {} : { overviewRails }),
		aspect: "poster",
		logActivity: fixtureLogger,
		recipes: flatFixtureRecipes,
		presentationFacts: () => [],
		overviewLoadingDetail: catalogMessage("overview.loading.book"),
		group: { actionLabel: catalogMessage("group.view-collection") },
		facts: () => [{ value: "3", icon: "hash", label: "Fixture count" }],
		measureFigure: { value: mediaActivityTimeLabel, label: catalogMessage("activity.figure-time") },
		creditCopy: {
			people: catalogMessage("credits.people"),
			notice: catalogMessage("credits.notice"),
			companies: catalogMessage("credits.companies"),
		},
		activityCopy: () => ({
			...fixtureActivityCopy,
			rowLabels: {
				...fixtureActivityCopy.rowLabels,
				progress: (percent) =>
					Text(percent === undefined ? "Part-way through" : `${percent}% through`),
			},
		}),
	});

export const fixtureSchema = defineFixtureSchema();

export const railItem = (
	id: string,
	name: string,
): MediaSavedViewPresentationSubject & { readonly isInMediaLibrary: boolean } => ({
	id,
	name,
	isInMediaLibrary: false,
	image: { type: "s3", key: `${id}-cover` },
	translationStatus: { state: "idle", availability: "none" },
	populationStatus: { state: "succeeded", availability: "complete" },
});

export const railedFixtureSchema = defineFixtureSchema(() => [
	{
		key: "first",
		items: [railItem("rail-1", "Alpha")],
		title: catalogMessage("credits.section.movie"),
	},
	{ items: [], key: "empty", title: catalogMessage("credits.section.show") },
	{
		key: "second",
		items: [railItem("rail-2", "Beta")],
		title: catalogMessage("credits.section.book"),
	},
]);

export const ungroupedFixtureSchema = defineFlatMediaSchema({
	facts: () => [],
	aspect: "square",
	logActivity: fixtureLogger,
	presentationFacts: () => [],
	recipes: flatUngroupedFixtureRecipes,
	overviewLoadingDetail: catalogMessage("overview.loading.book"),
	measureFigure: { value: mediaActivityTimeLabel, label: catalogMessage("activity.figure-time") },
	creditCopy: {
		people: catalogMessage("credits.people"),
		notice: catalogMessage("credits.notice"),
		companies: catalogMessage("credits.companies"),
	},
	activityCopy: () => ({
		...fixtureActivityCopy,
		rowLabels: {
			...fixtureActivityCopy.rowLabels,
			progress: (percent: number | undefined, position: UngroupedProgressPosition) =>
				Text(
					position.fixtureChapter === null
						? `${percent ?? "Some"}% through`
						: `Chapter ${position.fixtureChapter}`,
				),
		},
	}),
});
