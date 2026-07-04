import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { DateTime, Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, stringValue } from "../../script-helpers/records";
import { createRoleAccumulator } from "../../script-helpers/role-accumulator";
import {
	buildIgdbImageUrl,
	buildPagination,
	makeIgdbRequest,
	readTotalItems,
} from "../igdb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "IGDB",
	slug: "company.igdb",
	requiredPluginConfigKeys: ["twitchClientId", "twitchClientSecret"],
	requiredSystemConfigKeys: [],
	capabilities: ["httpCall", "getPluginConfig", "getCachedValue", "setCachedValue"],
});

const IMAGE_BASE_URL = "https://images.igdb.com/igdb/image/upload/t_logo_med";

const getImageUrl = (imageId: string) => buildIgdbImageUrl(IMAGE_BASE_URL, imageId);

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const offset = (input.page - 1) * input.pageSize;
		const body = [
			"fields id, name, logo.image_id;",
			`search "${input.query}";`,
			`limit ${input.pageSize};`,
			`offset ${offset};`,
		].join("\n");
		return makeIgdbRequest(host, "companies", body).pipe(
			Effect.map(({ data: results, headers }) => {
				if (!Array.isArray(results)) {
					throw new Error("IGDB company search returned unexpected response format");
				}
				const totalItems = readTotalItems(headers, results.length, offset);
				const items = results.flatMap((company) => {
					const record = asRecord(company);
					const id = numberValue(record?.["id"]);
					const name = stringValue(record?.["name"]);
					if (id === null || !name) {
						return [];
					}
					const imageId = stringValue(asRecord(record?.["logo"])?.["image_id"]);
					const image = imageId ? getImageUrl(imageId) : null;
					return [
						{
							externalId: String(id),
							calloutProperty: { kind: "null" as const, value: null },
							titleProperty: { kind: "text" as const, value: name },
							primarySubtitleProperty: { kind: "null" as const, value: null },
							secondarySubtitleProperty: { kind: "null" as const, value: null },
							imageProperty:
								image === null
									? { kind: "null" as const, value: null }
									: { kind: "image" as const, value: { type: "remote" as const, url: image } },
						},
					];
				});
				return { items, details: buildPagination(offset, results.length, totalItems, input.page) };
			}),
		);
	},
});

const DETAIL_FIELDS =
	"fields id, name, description, logo.image_id, start_date, websites.url, country, url, developed.id, developed.name, published.id, published.name;";

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		if (!/^\d+$/.test(input.externalId)) {
			throw new Error("externalId must be a numeric IGDB company ID");
		}
		const body = [DETAIL_FIELDS, `where id = ${input.externalId};`].join("\n");
		return makeIgdbRequest(host, "companies", body).pipe(
			Effect.map(({ data: results }) => {
				if (!Array.isArray(results) || results.length === 0) {
					throw new Error("IGDB returned no company data for this externalId");
				}
				const company = asRecord(results[0]);
				const name = stringValue(company?.["name"]);
				if (!name) {
					throw new Error("IGDB company payload is missing name");
				}

				const images: Array<{ type: "remote"; url: string }> = [];
				const logoImageId = stringValue(asRecord(company?.["logo"])?.["image_id"]);
				if (logoImageId) {
					images.push({ type: "remote", url: getImageUrl(logoImageId) });
				}

				const startDate = numberValue(company?.["start_date"]);
				const foundedYear =
					startDate === null
						? null
						: DateTime.toDateUtc(DateTime.makeUnsafe(startDate * 1000)).getFullYear();

				const websites = Array.isArray(company?.["websites"]) ? company["websites"] : [];
				const firstWebsiteUrl = stringValue(asRecord(websites[0])?.["url"]);
				const website = firstWebsiteUrl ?? stringValue(company?.["url"]);

				const accumulator = createRoleAccumulator();
				const addGames = (games: unknown, role: string) => {
					for (const game of Array.isArray(games) ? games : []) {
						const record = asRecord(game);
						const id = numberValue(record?.["id"]);
						const gameName = stringValue(record?.["name"]);
						if (id === null || !gameName) {
							continue;
						}
						accumulator.add({
							name: gameName,
							externalId: String(Math.trunc(id)),
							providerSlug: "video-game.igdb",
							relationshipProperties: { roles: [role] },
						});
					}
				};
				addGames(company?.["developed"], "Developer");
				addGames(company?.["published"], "Publisher");

				return {
					name,
					relatedEntityGroups: [
						{
							direction: "outgoing" as const,
							synchronization: "authoritative" as const,
							entities: accumulator.entities,
							relationshipSchemaSlug: "company-to-video-game",
						},
					],
					properties: {
						images,
						website,
						foundedYear,
						alternateNames: [],
						description: stringValue(company?.["description"]),
						sourceUrl: `https://www.igdb.com/companies/${input.externalId}`,
					},
				};
			}),
		);
	},
});
