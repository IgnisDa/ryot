import { dayjs } from "@ryot/ts-utils/dayjs";
import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

import {
	createBacklogEvent,
	createDroppedEvent,
	createOnHoldEvent,
	createProgressEvent,
	createReviewEvent,
	finalizeEntityGroups,
	normalizeRating,
	parseDateWithFormat,
} from "../../media/book/shared";
import { getOrCreateMediaEntityGroup } from "../../media/groups";
import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "../../media/import-processor";

type MyanimelistLot = "anime" | "manga";

type MyanimelistXmlItem = Record<string, string | undefined>;

type MyanimelistXmlDocument = {
	myanimelist?: Partial<Record<MyanimelistLot, MyanimelistXmlItem[]>>;
};

type MyanimelistItem = {
	done: number;
	title: string;
	myScore: number;
	myStatus?: string;
	identifier: string;
	myStartDate: string;
	myFinishDate: string;
};

const myanimelistXmlParser = new XMLParser({
	htmlEntities: true,
	isArray: (tagName) => tagName === "anime" || tagName === "manga",
	parseTagValue: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isMyanimelistXmlItem = (value: unknown): value is MyanimelistXmlItem =>
	isRecord(value) &&
	Object.values(value).every((entry) => entry === undefined || typeof entry === "string");

const isMyanimelistXmlDocument = (value: unknown): value is MyanimelistXmlDocument => {
	if (!isRecord(value)) {
		return false;
	}

	const myanimelist = value.myanimelist;
	if (!isRecord(myanimelist)) {
		return false;
	}

	const anime = myanimelist.anime;
	const manga = myanimelist.manga;
	return (
		(anime === undefined || (Array.isArray(anime) && anime.every(isMyanimelistXmlItem))) &&
		(manga === undefined || (Array.isArray(manga) && manga.every(isMyanimelistXmlItem)))
	);
};

const getLotItems = (xmlText: string, lot: MyanimelistLot): MyanimelistXmlItem[] => {
	const validation = SyntaxValidator.validate(xmlText);
	if (validation !== true) {
		throw new Error(validation.err.msg);
	}

	const parsed = myanimelistXmlParser.parse(xmlText);
	if (!isMyanimelistXmlDocument(parsed)) {
		return [];
	}

	return parsed.myanimelist?.[lot] ?? [];
};

const getText = (item: MyanimelistXmlItem, tagName: string): string => {
	const value = item[tagName];
	return typeof value === "string" ? value.trim() : "";
};

const getStatusLifecycle = (status: string) => {
	const normalized = status
		.trim()
		.toLowerCase()
		.replace(/[^a-z]+/g, " ")
		.trim();
	if (["watching", "reading"].includes(normalized)) {
		return "progress" as const;
	}
	if (["plan to watch", "plan to read"].includes(normalized)) {
		return "backlog" as const;
	}
	if (normalized === "dropped") {
		return "dropped" as const;
	}
	if (normalized === "on hold") {
		return "on_hold" as const;
	}
	return undefined;
};

const parseMyanimelistItem = (item: MyanimelistXmlItem, lot: MyanimelistLot): MyanimelistItem => {
	const doneTag = lot === "anime" ? "my_watched_episodes" : "my_read_chapters";
	const identifierTag = lot === "anime" ? "series_animedb_id" : "manga_mangadb_id";
	const titleTag = lot === "anime" ? "series_title" : "manga_title";
	const done = Number.parseInt(getText(item, doneTag), 10);
	if (!Number.isInteger(done) || done < 0) {
		throw new Error(`${doneTag} is invalid`);
	}
	const myScore = Number.parseInt(getText(item, "my_score"), 10);
	if (!Number.isInteger(myScore) || myScore < 0) {
		throw new Error("my_score is invalid");
	}
	const identifier = getText(item, identifierTag);
	if (!identifier) {
		throw new Error(`${identifierTag} is empty`);
	}
	return {
		done,
		myScore,
		identifier,
		title: getText(item, titleTag),
		myStartDate: getText(item, "my_start_date"),
		myFinishDate: getText(item, "my_finish_date"),
		myStatus: getText(item, "my_status") || undefined,
	};
};

const parseMalDate = (value: string): string | null =>
	value.startsWith("0000") || value.length === 0 ? null : parseDateWithFormat(value, "YYYY-MM-DD");

const addProgressCoverage = (
	lot: MyanimelistLot,
	group: ReturnType<typeof getOrCreateMediaEntityGroup>,
	count: number,
	occurredAt: string,
) => {
	for (let progress = 1; progress <= count; progress++) {
		group.events.push({
			occurredAt,
			eventSchemaSlug: "progress",
			properties:
				lot === "anime"
					? { progressPercent: 100, animeEpisode: progress }
					: { progressPercent: 100, mangaChapter: progress },
		});
	}
};

const adaptMyanimelistLot = (
	groupMap: Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>,
	failures: MediaImportAdapterFailure[],
	input: { itemIndex: number; lot: MyanimelistLot; xmlText: string },
): number => {
	const itemBlocks = getLotItems(input.xmlText, input.lot);
	let itemIndex = input.itemIndex;

	for (const block of itemBlocks) {
		try {
			const item = parseMyanimelistItem(block, input.lot);
			const target =
				input.lot === "anime"
					? { entitySchemaSlug: "anime" as const, scriptSlug: "anime.myanimelist" as const }
					: { entitySchemaSlug: "manga" as const, scriptSlug: "manga.myanimelist" as const };
			const occurredAt =
				parseMalDate(item.myFinishDate) ?? parseMalDate(item.myStartDate) ?? dayjs().toISOString();
			const sourceLabel =
				item.title || `${input.lot === "anime" ? "Anime" : "Manga"} ${item.identifier}`;
			const group = getOrCreateMediaEntityGroup(
				groupMap,
				{
					sourceLabel,
					kind: "resolved",
					externalId: item.identifier,
					scriptSlug: target.scriptSlug,
					entitySchemaSlug: target.entitySchemaSlug,
				},
				itemIndex,
			);

			if (item.done > 0) {
				addProgressCoverage(input.lot, group, item.done, occurredAt);
			}

			const lifecycle = getStatusLifecycle(item.myStatus ?? "");
			if (lifecycle === "progress") {
				group.events.push(createProgressEvent(occurredAt));
			} else if (lifecycle === "backlog") {
				group.events.push(createBacklogEvent(occurredAt));
			} else if (lifecycle === "dropped") {
				group.events.push(createDroppedEvent({ occurredAt }));
			} else if (lifecycle === "on_hold") {
				group.events.push(createOnHoldEvent({ occurredAt }));
			}

			const reviewEvent = createReviewEvent({
				occurredAt,
				rating: normalizeRating(String(item.myScore)),
			});
			if (reviewEvent) {
				group.events.push(reviewEvent);
			}
		} catch (error) {
			failures.push({
				itemIndex,
				message: error instanceof Error ? error.message : "MyAnimeList item is malformed",
			});
		}
		itemIndex++;
	}

	return itemIndex;
};

export const adaptMyanimelistExports = (input: {
	animeXml?: string;
	mangaXml?: string;
}): MediaImportAdapterResult => {
	const failures: MediaImportAdapterFailure[] = [];
	const groupMap = new Map<string, ReturnType<typeof getOrCreateMediaEntityGroup>>();

	let itemIndex = 0;
	if (input.animeXml) {
		itemIndex = adaptMyanimelistLot(groupMap, failures, {
			itemIndex,
			lot: "anime",
			xmlText: input.animeXml,
		});
	}
	if (input.mangaXml) {
		adaptMyanimelistLot(groupMap, failures, {
			itemIndex,
			lot: "manga",
			xmlText: input.mangaXml,
		});
	}

	return { entityGroups: finalizeEntityGroups(groupMap), failures };
};
