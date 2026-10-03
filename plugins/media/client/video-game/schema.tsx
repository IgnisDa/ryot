import type { Recipe } from "@ryot-app/client-sdk/ryotql";

import type { MediaPresentationDataOf, MediaSummaryOf } from "../../shared/media-recipes";
import { videoGameRelationKinds } from "../../shared/video-game";
import { videoGameRecipes } from "../../shared/video-game-recipes";
import { mediaFlatActivityCopy } from "../media/activity-copy";
import { mediaActivityDurationLabel, mediaActivityTimeLabel } from "../media/activity-timeline";
import { defineFlatMediaSchema, type MediaOverviewRail } from "../media/flat-schema";
import { MEDIA_ART_HEIGHT, MEDIA_BACKDROP_HEIGHT } from "../media/hero";
import type { MediaSummaryFact } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";
import { videoGameOverviewTrailing } from "./sections";

type VideoGameSummary = MediaSummaryOf<typeof videoGameRecipes>;

type VideoGamePresentation = MediaPresentationDataOf<typeof videoGameRecipes>;

type VideoGameOverview = Recipe.Success<typeof videoGameRecipes.overviewRecipe>;

const RELATED_KIND = "Related";

const RELATION_KIND_PLURALS: Readonly<Record<string, string>> = {
	DLC: "DLC",
	Mod: "Mods",
	Port: "Ports",
	Remake: "Remakes",
	Edition: "Editions",
	Remaster: "Remasters",
	Expansion: "Expansions",
	"Expanded Game": "Expanded games",
	"Standalone Expansion": "Standalone expansions",
};

const kindRank = (kind: string) => {
	const rank = videoGameRelationKinds.findIndex((known) => known === kind);
	return rank === -1 ? videoGameRelationKinds.length : rank;
};

export const videoGameSummaryFacts = (game: VideoGameSummary): readonly MediaSummaryFact[] => {
	const normally = game.timeToBeat?.normally ?? undefined;
	return [
		...(game.gameType === null ? [] : [{ label: "Type", icon: "gamepad-2", value: game.gameType }]),
		...(normally === undefined
			? []
			: [
					{ icon: "hourglass", label: "Time to beat", value: mediaActivityDurationLabel(normally) },
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
			key: `original:${parent.id}`,
			title: `${parent.kind ?? RELATED_KIND} of ${parent.name}`,
		})),
		...[...children]
			.sort(([left], [right]) => kindRank(left) - kindRank(right) || left.localeCompare(right))
			.map(([kind, items]) => ({
				items,
				key: `kind:${kind}`,
				title: RELATION_KIND_PLURALS[kind] ?? kind,
			})),
	];
};

export const videoGamePresentationFacts = (game: VideoGamePresentation) =>
	game.timeToBeatNormally === null ? [] : [mediaActivityDurationLabel(game.timeToBeatNormally)];

export const videoGameSchema = defineFlatMediaSchema({
	recipes: videoGameRecipes,
	facts: videoGameSummaryFacts,
	backdropPurposes: ["artwork"],
	overviewRails: videoGameOverviewRails,
	aspect: mediaSchemaAspects["video-game"],
	overviewTrailing: videoGameOverviewTrailing,
	presentationFacts: videoGamePresentationFacts,
	measureFigure: { label: "Time", value: mediaActivityTimeLabel },
	nouns: { plural: "games", singular: "game", title: "Video Game" },
	activityCopy: mediaFlatActivityCopy({ verb: "play", noun: "game" }),
	heroHeight: (compact) => (compact ? MEDIA_ART_HEIGHT : MEDIA_BACKDROP_HEIGHT),
	group: { actionLabel: "View collection", title: (name) => `Part of ${name}` },
	overviewLoadingDetail: "Fetching the credits, companies and recommendations for this game.",
	creditCopy: {
		people: "Cast & credits",
		companies: "Developers & publishers",
		notice: "Credits, companies and recommendations",
	},
});
