import type { MediaCreatorCreditSlug } from "../../shared/media-schema-slugs";
import type { MediaCreditSection } from "../media/credit-rails";
import type { MediaSummaryLink } from "../media/summary-state";
import { mediaSchemaAspects } from "../schema-aspects";

const CREDIT_SECTION_TITLES: Record<MediaCreatorCreditSlug, string> = {
	book: "Books",
	show: "Shows",
	anime: "Anime",
	manga: "Manga",
	movie: "Movies",
	music: "Tracks",
	podcast: "Podcasts",
	"music-group": "Albums",
	audiobook: "Audiobooks",
	"comic-book": "Comic books",
	"video-game": "Video games",
	"visual-novel": "Visual novels",
	"video-game-group": "Game collections",
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

export const creatorLinks = (creator: {
	readonly website: string | null;
	readonly sourceUrl: string | null;
	readonly providerName: string | null;
}): readonly MediaSummaryLink[] =>
	[
		{ label: "Website", href: creator.website },
		{ href: creator.sourceUrl, label: `${creator.providerName ?? "Source"} page` },
	].flatMap(({ href, label }) =>
		href !== null && /^https?:\/\//i.test(href) ? [{ href, label }] : [],
	);
