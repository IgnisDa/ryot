import { Either } from "@ryot/sandbox-sdk/effect";
import { XMLParser } from "@ryot/sandbox-sdk/fast-xml-parser";

import { nowIso, parseDateWithFormat } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	createBacklogEvent,
	createDroppedEvent,
	createOnHoldEvent,
	createProgressEvent,
	createReviewEvent,
	finalizeEntityGroups,
	normalizeRating,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

type MyanimelistLot = "anime" | "manga";
type MyanimelistXmlItem = Record<string, string | undefined>;

const parser = new XMLParser({
	htmlEntities: true,
	parseTagValue: false,
	isArray: (tagName) => tagName === "anime" || tagName === "manga",
});

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isXmlItem = (value: unknown): value is MyanimelistXmlItem =>
	isObjectRecord(value) &&
	Object.values(value).every((entry) => entry === undefined || typeof entry === "string");

const assertWellFormedXml = (xml: string) => {
	const stack: string[] = [];
	const withoutOpaqueBlocks = xml.replace(
		/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g,
		"",
	);
	for (const match of withoutOpaqueBlocks.matchAll(
		/<\s*(\/?)\s*([\w:.-]+)(?:\s[^<>]*?)?(\/?)\s*>/g,
	)) {
		const [, closing, name, selfClosing] = match;
		if (!name || selfClosing) {
			continue;
		}
		if (!closing) {
			stack.push(name);
			continue;
		}
		if (stack.pop() !== name) {
			throw new Error(`Unexpected closing tag ${name}`);
		}
	}
	if (stack.length > 0) {
		throw new Error(`Unclosed tag ${stack.at(-1)}`);
	}
};

const lotItems = (xmlText: string, lot: MyanimelistLot) => {
	assertWellFormedXml(xmlText);
	const document = parser.parse(xmlText) as unknown;
	if (!isObjectRecord(document) || !isObjectRecord(document["myanimelist"])) {
		return [];
	}
	const items = document["myanimelist"][lot];
	return Array.isArray(items) && items.every(isXmlItem) ? items : [];
};

const text = (item: MyanimelistXmlItem, tag: string) => item[tag]?.trim() ?? "";

const lifecycle = (status: string) => {
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

const malDate = (value: string) =>
	value.startsWith("0000") || !value ? null : parseDateWithFormat(value, "YYYY-MM-DD");

const addCoverage = (
	lot: MyanimelistLot,
	group: ImportMediaEntityGroupBuilder,
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

const adaptLot = (
	groups: Map<string, ImportMediaEntityGroupBuilder>,
	failures: MediaImportAdapterFailure[],
	input: { itemIndex: number; lot: MyanimelistLot; xmlText: string },
) => {
	let itemIndex = input.itemIndex;
	for (const item of lotItems(input.xmlText, input.lot)) {
		const index = itemIndex++;
		const adapted = Either.try(() => {
			const doneTag = input.lot === "anime" ? "my_watched_episodes" : "my_read_chapters";
			const idTag = input.lot === "anime" ? "series_animedb_id" : "manga_mangadb_id";
			const titleTag = input.lot === "anime" ? "series_title" : "manga_title";
			const done = Number.parseInt(text(item, doneTag), 10);
			if (!Number.isInteger(done) || done < 0) {
				throw new Error(`${doneTag} is invalid`);
			}
			const score = Number.parseInt(text(item, "my_score"), 10);
			if (!Number.isInteger(score) || score < 0) {
				throw new Error("my_score is invalid");
			}
			const identifier = text(item, idTag);
			if (!identifier) {
				throw new Error(`${idTag} is empty`);
			}
			const title = text(item, titleTag);
			const occurredAt =
				malDate(text(item, "my_finish_date")) ?? malDate(text(item, "my_start_date")) ?? nowIso();
			const target =
				input.lot === "anime"
					? { entitySchemaSlug: "anime" as const, providerSlug: "anime.myanimelist" as const }
					: { entitySchemaSlug: "manga" as const, providerSlug: "manga.myanimelist" as const };
			const group = getOrCreateMediaEntityGroup(
				groups,
				{
					kind: "resolved",
					externalId: identifier,
					providerSlug: target.providerSlug,
					entitySchemaSlug: target.entitySchemaSlug,
					sourceLabel: title || `${input.lot === "anime" ? "Anime" : "Manga"} ${identifier}`,
				},
				index,
			);
			if (done > 0) {
				addCoverage(input.lot, group, done, occurredAt);
			}
			const status = lifecycle(text(item, "my_status"));
			if (status === "progress") {
				group.events.push(createProgressEvent(occurredAt));
			} else if (status === "backlog") {
				group.events.push(createBacklogEvent(occurredAt));
			} else if (status === "dropped") {
				group.events.push(createDroppedEvent({ occurredAt }));
			} else if (status === "on_hold") {
				group.events.push(createOnHoldEvent({ occurredAt }));
			}
			const review = createReviewEvent({ occurredAt, rating: normalizeRating(String(score)) });
			if (review) {
				group.events.push(review);
			}
		});
		if (Either.isLeft(adapted)) {
			failures.push({
				itemIndex: index,
				message:
					adapted.left instanceof Error ? adapted.left.message : "MyAnimeList item is malformed",
			});
		}
	}
	return itemIndex;
};

export const adaptMyanimelistExports = (input: {
	animeXml?: string | undefined;
	mangaXml?: string | undefined;
}) => {
	const failures: MediaImportAdapterFailure[] = [];
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	let itemIndex = 0;
	if (input.animeXml) {
		itemIndex = adaptLot(groups, failures, { itemIndex, lot: "anime", xmlText: input.animeXml });
	}
	if (input.mangaXml) {
		itemIndex = adaptLot(groups, failures, { itemIndex, lot: "manga", xmlText: input.mangaXml });
	}
	return { totalItems: itemIndex, entityGroups: finalizeEntityGroups(groups.values()), failures };
};
