import type { LocalMessage } from "@ryot-app/plugin-client-sdk";

import type { MediaCreatorCreditSlug } from "../../shared/media-schema-slugs";
import { catalogMessage } from "../../shared/messages.generated";
import type { MediaCreditSection } from "../media/credit-rails";
import { mediaSchemaAspects } from "../schema-aspects";

const CREDIT_SECTION_TITLES: Record<MediaCreatorCreditSlug, LocalMessage> = {
	book: catalogMessage("credits.section.book"),
	show: catalogMessage("credits.section.show"),
	movie: catalogMessage("credits.section.movie"),
	music: catalogMessage("credits.section.music"),
	anime: catalogMessage("entity-schema.anime.name"),
	manga: catalogMessage("entity-schema.manga.name"),
	podcast: catalogMessage("credits.section.podcast"),
	audiobook: catalogMessage("credits.section.audiobook"),
	"comic-book": catalogMessage("credits.section.comic-book"),
	"video-game": catalogMessage("credits.section.video-game"),
	"music-group": catalogMessage("credits.section.music-group"),
	"visual-novel": catalogMessage("credits.section.visual-novel"),
	"video-game-group": catalogMessage("credits.section.video-game-group"),
};

const CREDIT_SECTION_ORDER = [
	"movie",
	"show",
	"anime",
	"book",
	"comic-book",
	"manga",
	"visual-novel",
	"video-game",
	"video-game-group",
	"music-group",
	"music",
	"audiobook",
	"podcast",
] as const satisfies readonly MediaCreatorCreditSlug[];

const exhaustiveCreditSectionOrder: [
	Exclude<MediaCreatorCreditSlug, (typeof CREDIT_SECTION_ORDER)[number]>,
] extends [never]
	? typeof CREDIT_SECTION_ORDER
	: never = CREDIT_SECTION_ORDER;

export const creatorCreditSections: readonly MediaCreditSection<MediaCreatorCreditSlug>[] =
	exhaustiveCreditSectionOrder.map((slug) => ({
		slug,
		aspect: mediaSchemaAspects[slug],
		title: CREDIT_SECTION_TITLES[slug],
	}));
