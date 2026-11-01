import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import {
	defineProvider,
	type ProviderDetailsRelatedEntity,
	type ProviderRelatedResult,
} from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaSandboxError } from "../../../lib/failures";
import { normalizePlainDescription } from "../../../lib/plain-description";
import { numberValue, stringValue } from "../../../lib/records";
import {
	buildLuceneQuery,
	mbBrowsePage,
	mbGet,
	mbOffsetCursor,
} from "../../../lib/vendors/music-brainz";

export const manifest = defineManifest({
	kind: "provider",
	name: "MusicBrainz",
	slug: "person.music-brainz",
});

const RELATED_BROWSE_PAGE_BATCH_SIZE = 10;

const buildArtistDescription = (artist: Record<string, unknown>) => {
	const parts: string[] = [];

	const artistType = stringValue(artist["type"]);
	if (artistType) {
		parts.push(artistType);
	}

	const country = stringValue(artist["country"]);
	if (country) {
		parts.push(`Country: ${country}`);
	}

	const area = stringValue(asRecord(artist["area"])?.["name"]);
	if (area) {
		parts.push(`Area: ${area}`);
	}

	const lifeSpan = asRecord(artist["life-span"]);
	if (lifeSpan) {
		const begin = stringValue(lifeSpan["begin"]);
		const end = stringValue(lifeSpan["end"]);
		if (begin || end) {
			parts.push(`Active: ${begin ?? "?"} - ${end ?? "?"}`);
		}
	}

	const disambiguation = stringValue(artist["disambiguation"]);
	if (disambiguation) {
		parts.push(disambiguation);
	}

	return parts.length > 0 ? parts.join(" - ") : null;
};

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const luceneQuery = buildLuceneQuery(input.query, ["artist", "alias"]);
		return mbGet(host, "artist", {
			query: luceneQuery,
			limit: String(input.pageSize),
			offset: String((input.page - 1) * input.pageSize),
		}).pipe(
			Effect.map((dataValue) => {
				const data = asRecord(dataValue);
				if (!data) {
					throw new Error("MusicBrainz artist search returned no data");
				}
				const totalItems = Math.max(0, numberValue(data["count"]) ?? 0);
				const artists = data["artists"];
				const items = asArray(artists).flatMap((artist) => {
					const record = asRecord(artist);
					const id = stringValue(record?.["id"]);
					if (!id) {
						return [];
					}
					const name = stringValue(record?.["name"]) ?? id;
					return [{ title: name, externalId: id }];
				});
				return {
					items,
					details: {
						totalItems,
						nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
					},
				};
			}),
		);
	},
});

const inventories = {
	"person-to-music": { entity: "recording", providerSlug: "music.music-brainz" },
	"person-to-music-group": { entity: "release-group", providerSlug: "music-group.music-brainz" },
} as const;

const inventoryEntities = (items: readonly Record<string, unknown>[], providerSlug: string) => {
	const entities = new Map<string, ProviderDetailsRelatedEntity>();
	for (const item of items) {
		const externalId = stringValue(item["id"]);
		if (externalId && !entities.has(externalId)) {
			entities.set(externalId, {
				externalId,
				providerSlug,
				relationshipProperties: { roles: ["Artist"] },
				name: stringValue(item["title"]) ?? externalId,
			});
		}
	}
	return [...entities.values()];
};

const inventoryCoverage = (page: {
	total: null | number;
	nextOffset: null | number;
}): ProviderRelatedResult["coverage"] =>
	page.nextOffset === null
		? { status: "complete" }
		: { status: "more", continuation: { total: page.total, offset: page.nextOffset } };

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) =>
		Effect.all(
			[
				mbGet(host, `artist/${input.externalId}`, { inc: "aliases" }),
				mbBrowsePage(host, "recording", { artist: input.externalId }, 0, null),
				mbBrowsePage(
					host,
					"release-group",
					{ artist: input.externalId, "release-group-status": "all" },
					0,
					null,
				),
			],
			{ concurrency: "unbounded" },
		).pipe(
			Effect.map(([artistValue, recordings, releaseGroups]) => {
				const artist = asRecord(artistValue);
				if (!artist) {
					throw new Error(`MusicBrainz artist not found: ${input.externalId}`);
				}
				const name = stringValue(artist["name"]);
				if (!name) {
					throw new Error("MusicBrainz artist is missing name");
				}

				const lifeSpan = asRecord(artist["life-span"]);
				const birthDate = lifeSpan ? stringValue(lifeSpan["begin"]) : null;
				const deathDate = lifeSpan ? stringValue(lifeSpan["end"]) : null;

				const birthPlace =
					stringValue(asRecord(artist["begin-area"])?.["name"]) ??
					stringValue(asRecord(artist["area"])?.["name"]);

				const description = normalizePlainDescription(buildArtistDescription(artist));

				const aliases = asArray(artist["aliases"]);
				const alternateNames = aliases.flatMap((alias) => {
					const aliasName = stringValue(asRecord(alias)?.["name"]);
					return aliasName !== null && aliasName !== name ? [aliasName] : [];
				});

				return {
					name,
					properties: {
						birthDate,
						deathDate,
						birthPlace,
						images: [],
						description,
						alternateNames,
						sourceUrl: `https://musicbrainz.org/artist/${input.externalId}`,
					},
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "additive" as const,
							coverage: inventoryCoverage(recordings),
							relationshipSchemaSlug: "person-to-music",
							entities: inventoryEntities(recordings.items, "music.music-brainz"),
						},
						{
							direction: "outgoing" as const,
							synchronization: "additive" as const,
							coverage: inventoryCoverage(releaseGroups),
							relationshipSchemaSlug: "person-to-music-group",
							entities: inventoryEntities(releaseGroups.items, "music-group.music-brainz"),
						},
					],
				};
			}),
		),
});

export const related = defineProvider({
	manifest,
	operation: "related",
	run: (input, host) =>
		Effect.gen(function* () {
			const config =
				input.relationshipSchemaSlug === "person-to-music" ||
				input.relationshipSchemaSlug === "person-to-music-group"
					? inventories[input.relationshipSchemaSlug]
					: null;
			if (!config || input.direction !== "outgoing") {
				return yield* new MediaSandboxError({
					message: "Unsupported MusicBrainz artist inventory",
				});
			}
			let { total, offset } = yield* mbOffsetCursor(input.continuation);
			const items: Record<string, unknown>[] = [];
			for (let calls = 0; calls < RELATED_BROWSE_PAGE_BATCH_SIZE; calls++) {
				const page = yield* mbBrowsePage(
					host,
					config.entity,
					{
						artist: input.externalId,
						...(config.entity === "release-group" ? { "release-group-status": "all" } : {}),
					},
					offset,
					total,
				);
				items.push(...page.items);
				if (page.nextOffset === null) {
					return {
						coverage: { status: "complete" as const },
						entities: inventoryEntities(items, config.providerSlug),
					};
				}
				offset = page.nextOffset;
				total = page.total;
			}
			return {
				entities: inventoryEntities(items, config.providerSlug),
				coverage: { status: "more" as const, continuation: { total, offset } },
			};
		}),
});
