import type { Recipe } from "@ryot-app/plugin-client-sdk/ryotql";
import { formatDuration } from "@ryot-app/plugin-ui-sdk";

import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { videoGameRelationKinds } from "../../shared/video-game";
import { videoGameRecipes } from "../../shared/video-game-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema, type MediaOverviewRail } from "../media/flat-schema";
import type { MediaSummaryFact } from "../media/summary-state";
import type { MediaCopy } from "../messages";
import { mediaSchemaAspects } from "../schema-aspects";
import { videoGameOverviewTrailing } from "./sections";

type VideoGameSummary = MediaSummaryOf<typeof videoGameRecipes>;

type VideoGamePresentation = MediaPresentationDataOf<typeof videoGameRecipes>;

type VideoGameOverview = Recipe.Success<ReturnType<typeof videoGameRecipes.overviewRecipe>>;

/** Groups children without a provider kind; it is a key, never displayed. */
const RELATED_KIND = "Related";

const RELATION_KIND_CODES = [
	["DLC", "DLC"],
	["Mod", "Mod"],
	["Port", "Port"],
	["Remake", "Remake"],
	["Edition", "Edition"],
	["Remaster", "Remaster"],
	["Expansion", "Expansion"],
	["Expanded Game", "Expanded_Game"],
	["Standalone Expansion", "Standalone_Expansion"],
] as const;

const relationCode = (kind: string) => RELATION_KIND_CODES.find(([known]) => known === kind)?.[1];

const relationPlural = (kind: string) => {
	const code = relationCode(kind);
	return code === undefined ? kind : catalogMessage("video-game.relation-plural", { kind: code });
};

const originalOf = (parent: { readonly name: string; readonly kind: null | string }) => {
	if (parent.kind === null) {
		return catalogMessage("video-game.original-of", { kind: "related", name: parent.name });
	}
	const code = relationCode(parent.kind);
	return code === undefined
		? catalogMessage("video-game.original-of-custom", { kind: parent.kind, name: parent.name })
		: catalogMessage("video-game.original-of", { kind: code, name: parent.name });
};

const kindRank = (kind: string) => {
	const rank = videoGameRelationKinds.findIndex((known) => known === kind);
	return rank === -1 ? videoGameRelationKinds.length : rank;
};

export const videoGameSummaryFacts = (
	game: VideoGameSummary,
	{ text, formatters }: MediaCopy,
): readonly MediaSummaryFact[] => {
	const normally = game.timeToBeat?.normally ?? undefined;
	return [
		...(game.gameType === null
			? []
			: [{ icon: "gamepad-2", value: game.gameType, label: text("property.type") }]),
		...(normally === undefined
			? []
			: [
					{
						icon: "hourglass",
						label: text("fact.time-to-beat"),
						value: formatDuration(formatters, normally * 60, "minute"),
					},
				]),
	];
};

export const videoGameOverviewRails = (
	overview: VideoGameOverview,
): readonly MediaOverviewRail[] => {
	const children = new Map<string, VideoGameOverview["derivatives"]["items"][number][]>();
	for (const item of overview.derivatives.items) {
		const kind = item.kind ?? RELATED_KIND;
		children.set(kind, [...(children.get(kind) ?? []), item]);
	}
	return [
		...overview.originals.items.map((parent) => ({
			items: [parent],
			title: originalOf(parent),
			key: `original:${parent.id}`,
		})),
		...[...children]
			.sort(([left], [right]) => kindRank(left) - kindRank(right) || left.localeCompare(right))
			.map(([kind, items]) => ({
				items,
				key: `kind:${kind}`,
				title: kind === RELATED_KIND ? catalogMessage("video-game.related") : relationPlural(kind),
			})),
	];
};

export const videoGamePresentationFacts = (
	game: VideoGamePresentation,
	{ formatters }: MediaCopy,
) =>
	game.timeToBeatNormally === null
		? []
		: [formatDuration(formatters, game.timeToBeatNormally * 60, "minute")];

export const videoGameSchema = defineFlatMediaSchema({
	recipes: videoGameRecipes,
	facts: videoGameSummaryFacts,
	overviewRails: videoGameOverviewRails,
	aspect: mediaSchemaAspects["video-game"],
	overviewTrailing: videoGameOverviewTrailing,
	presentationFacts: videoGamePresentationFacts,
	group: { actionLabel: catalogMessage("group.view-collection") },
	overviewLoadingDetail: catalogMessage("overview.loading.video-game"),
	activityCopy: (copy) => mediaFlatActivityCopy(copy, { verb: "play", kind: "video_game" }),
	logActivity: { family: "flat", timePrimary: true, copy: { verb: "play", kind: "video_game" } },
	measureFigure: { value: mediaActivityTimeLabel, label: catalogMessage("activity.figure-time") },
	creditCopy: {
		people: catalogMessage("credits.cast-credits"),
		notice: catalogMessage("credits.notice.video-game"),
		companies: catalogMessage("credits.developers-publishers"),
	},
});
