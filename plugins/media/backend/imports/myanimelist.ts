import { Option, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import {
	COMMON_HTML,
	CURRENCY,
	EntityDecoder,
	XMLParser,
} from "@ryot-app/plugin-backend-sdk/fast-xml-parser";

import { nowIso, parseDateWithFormat } from "./dates";
import { getOrCreateMediaEntityGroup, type ImportMediaEntityGroupBuilder } from "./groups";
import {
	createBacklogEvent,
	createCompleteEvent,
	createDroppedEvent,
	createOnHoldEvent,
	createProgressEvent,
	createReviewEvent,
	finalizeEntityGroups,
	normalizeRating,
} from "./helpers";
import type { MediaImportAdapterFailure } from "./schemas";

type MyanimelistLot = "anime" | "manga";

const createParser = () =>
	new XMLParser({
		parseTagValue: false,
		isArray: (tagName) => tagName === "anime" || tagName === "manga",
		entityDecoder: new EntityDecoder({
			numericAllowed: true,
			namedEntities: { ...COMMON_HTML, ...CURRENCY },
			limit: { applyLimitsTo: "all", maxExpandedLength: 100_000, maxTotalExpansions: Infinity },
		}),
	});

const MyanimelistItems = Schema.Array(Schema.Record(Schema.String, Schema.String));
type MyanimelistXmlItem = (typeof MyanimelistItems.Type)[number];
const decodeLotItems = {
	anime: Schema.decodeUnknownOption(
		Schema.Struct({ myanimelist: Schema.Struct({ anime: MyanimelistItems }) }),
	),
	manga: Schema.decodeUnknownOption(
		Schema.Struct({ myanimelist: Schema.Struct({ manga: MyanimelistItems }) }),
	),
};

const assertWellFormedXml = (xml: string) => {
	const stack: string[] = [];
	let withoutOpaqueBlocks = xml;
	let previous: string;
	do {
		previous = withoutOpaqueBlocks;
		withoutOpaqueBlocks = previous.replaceAll(
			/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g,
			"",
		);
	} while (withoutOpaqueBlocks !== previous);
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
	const document: unknown = createParser().parse(xmlText);
	return lot === "anime"
		? Option.match(decodeLotItems.anime(document), {
				onNone: () => [],
				onSome: (decoded) => decoded.myanimelist.anime,
			})
		: Option.match(decodeLotItems.manga(document), {
				onNone: () => [],
				onSome: (decoded) => decoded.myanimelist.manga,
			});
};

const text = (item: MyanimelistXmlItem, tag: string) => item[tag]?.trim() ?? "";

const lifecycle = (status: string) => {
	const normalized = status
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z]+/g, " ")
		.trim();
	if (["reading", "watching"].includes(normalized)) {
		return "progress" as const;
	}
	if (["plan to read", "plan to watch"].includes(normalized)) {
		return "backlog" as const;
	}
	if (normalized === "dropped") {
		return "dropped" as const;
	}
	if (normalized === "completed") {
		return "complete" as const;
	}
	if (normalized === "on hold") {
		return "on_hold" as const;
	}
	return undefined;
};

const malDate = (value: string) =>
	value.startsWith("0000") || !value ? null : parseDateWithFormat(value, "YYYY-MM-DD");

const adaptLot = (
	groups: Map<string, ImportMediaEntityGroupBuilder>,
	failures: MediaImportAdapterFailure[],
	input: { xmlText: string; itemIndex: number; importedAt: string; lot: MyanimelistLot },
) => {
	let itemIndex = input.itemIndex;
	for (const item of lotItems(input.xmlText, input.lot)) {
		const index = itemIndex++;
		const adapted = Result.try(() => {
			const doneTag = input.lot === "anime" ? "my_watched_episodes" : "my_read_chapters";
			const idTag = input.lot === "anime" ? "series_animedb_id" : "manga_mangadb_id";
			const titleTag = input.lot === "anime" ? "series_title" : "manga_title";
			const done = Number(text(item, doneTag));
			if (
				!text(item, doneTag).trim() ||
				!Number.isFinite(done) ||
				done < 0 ||
				(input.lot === "anime" && !Number.isSafeInteger(done))
			) {
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
				malDate(text(item, "my_finish_date")) ??
				malDate(text(item, "my_start_date")) ??
				input.importedAt;
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
				group.events.push({
					occurredAt,
					eventSchemaSlug: "progress",
					properties: {
						dateUnknown: true,
						...(input.lot === "anime" ? { animeEpisode: done } : { mangaChapter: done }),
					},
				});
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
			} else if (status === "complete") {
				const finished = malDate(text(item, "my_finish_date"));
				group.events.push(
					createCompleteEvent({
						occurredAt,
						sourceRun: "baseline",
						dateUnknown: !finished,
						...(finished ? { calendarDate: finished.slice(0, 10) } : {}),
					}),
				);
			}
			const review = createReviewEvent({ occurredAt, rating: normalizeRating(String(score), 10) });
			if (review) {
				group.events.push(review);
			}
		});
		if (Result.isFailure(adapted)) {
			failures.push({
				itemIndex: index,
				message:
					adapted.failure instanceof Error
						? adapted.failure.message
						: "MyAnimeList item is malformed",
			});
		}
	}
	return itemIndex;
};

export const adaptMyanimelistExports = (input: {
	animeXml?: string | undefined;
	mangaXml?: string | undefined;
	importedAt?: string | undefined;
}) => {
	const failures: MediaImportAdapterFailure[] = [];
	const groups = new Map<string, ImportMediaEntityGroupBuilder>();
	let itemIndex = 0;
	const importedAt = input.importedAt ?? nowIso();
	if (input.animeXml) {
		itemIndex = adaptLot(groups, failures, {
			itemIndex,
			importedAt,
			lot: "anime",
			xmlText: input.animeXml,
		});
	}
	if (input.mangaXml) {
		itemIndex = adaptLot(groups, failures, {
			itemIndex,
			importedAt,
			lot: "manga",
			xmlText: input.mangaXml,
		});
	}
	return { failures, totalItems: itemIndex, entityGroups: finalizeEntityGroups(groups.values()) };
};
