import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { ProviderSearchInput, ProviderSearchResult } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	numberValue,
	parseJsonResponse,
	recordsValue,
	stringValue,
	type UnknownRecord,
} from "../script-helpers/records";
import type { RoleRelatedEntity } from "../script-helpers/role-accumulator";

export type TvdbHost = SandboxHost<
	readonly ["httpCall", "getCachedValue", "setCachedValue", "getPluginConfigValue"]
>;

export type RemoteImage = { type: "remote"; url: string };

const TVDB_BASE_URL = "https://api4.thetvdb.com/v4";
const TOKEN_CACHE_KEY = "tvdb_access_token";
// TVDB tokens are valid for 30 days; cache for 23 hours as a safety buffer.
const TOKEN_CACHE_TTL_SECONDS = 23 * 60 * 60;

export const firstStringValue = (record: UnknownRecord, keys: readonly string[]) =>
	keys.reduce<string | null>((value, key) => value ?? stringValue(record[key]), null);

const getTvdbApiKey = (host: TvdbHost) =>
	host.getPluginConfigValue("tvdbApiKey").pipe(
		Effect.mapError((error) => new Error(error.message || "Failed to retrieve TVDB API key")),
		Effect.map((value) => {
			const key = stringValue(value);
			if (!key) {
				throw new Error(
					"TVDB API key is not configured. Set RYOT_PLUGIN_MEDIA_TVDB_API_KEY in your environment.",
				);
			}
			return key;
		}),
	);

export const getTvdbAccessToken = (host: TvdbHost): Effect.Effect<string, unknown> =>
	host.getCachedValue(TOKEN_CACHE_KEY).pipe(
		Effect.catchAll(() => Effect.succeed(null)),
		Effect.flatMap((cached) => {
			const cachedToken = stringValue(cached);
			if (cachedToken) {
				return Effect.succeed(cachedToken);
			}
			return getTvdbApiKey(host)
				.pipe(
					Effect.flatMap((apiKey) =>
						host.httpCall("POST", `${TVDB_BASE_URL}/login`, {
							body: JSON.stringify({ apikey: apiKey }),
							headers: { "Content-Type": "application/json" },
						}),
					),
				)
				.pipe(
					Effect.mapError((error) => new Error(error.message || "TVDB login request failed")),
					Effect.flatMap((response) => {
						const payload = asRecord(parseJsonResponse(response.body, "TVDB"));
						const token = stringValue(asRecord(payload?.["data"])?.["token"]);
						if (payload?.["status"] !== "success" || !token) {
							throw new Error("TVDB login returned no token");
						}
						const accessToken = `Bearer ${token}`;
						return host.setCachedValue(TOKEN_CACHE_KEY, accessToken, TOKEN_CACHE_TTL_SECONDS).pipe(
							Effect.as(accessToken),
							Effect.catchAll((error) => {
								console.warn(`TVDB token cache write failed: ${error.message}`);
								return Effect.succeed(accessToken);
							}),
						);
					}),
				);
		}),
	);

const tvdbRequest = (
	host: TvdbHost,
	path: string,
	params: Readonly<Record<string, string>> | undefined,
	options: { readonly allowMissing: boolean },
) =>
	getTvdbAccessToken(host).pipe(
		Effect.flatMap((token) => {
			const query =
				params && Object.keys(params).length > 0
					? `?${new URLSearchParams(params).toString()}`
					: "";
			return host
				.httpCall("GET", `${TVDB_BASE_URL}${path}${query}`, { headers: { Authorization: token } })
				.pipe(
					Effect.map((response) => {
						const payload = asRecord(parseJsonResponse(response.body, "TVDB"));
						if (!payload) {
							throw new Error("TVDB returned an invalid response object");
						}
						const payloadStatus = payload["status"];
						if (payloadStatus && payloadStatus !== "success") {
							const message =
								stringValue(payload["message"]) ??
								stringValue(payloadStatus) ??
								JSON.stringify(payloadStatus);
							throw new Error(`TVDB API error: ${message}`);
						}
						return payload;
					}),
					Effect.catchAll((error) =>
						options.allowMissing
							? Effect.succeed(null)
							: Effect.fail(new Error(error.message || `TVDB request failed: ${path}`)),
					),
				);
		}),
	);

export const tvdbGet = (host: TvdbHost, path: string, params?: Readonly<Record<string, string>>) =>
	tvdbRequest(host, path, params, { allowMissing: false }).pipe(
		Effect.map((payload) => {
			if (!payload) {
				throw new Error(`TVDB request failed: ${path}`);
			}
			return payload;
		}),
	);

export const tvdbGetOptional = (
	host: TvdbHost,
	path: string,
	params?: Readonly<Record<string, string>>,
) => tvdbRequest(host, path, params, { allowMissing: true });

const TVDB_LANGUAGE_MAP: Readonly<Record<string, string>> = {
	en: "eng",
	es: "spa",
	fr: "fra",
	de: "deu",
	it: "ita",
	pt: "por",
	ja: "jpn",
	ko: "kor",
	zh: "zho",
	ru: "rus",
	nl: "nld",
	pl: "pol",
	sv: "swe",
	da: "dan",
	fi: "fin",
	nb: "nob",
	tr: "tur",
	cs: "ces",
};

export const bcp47ToTvdb = (language: string) => {
	const [base = ""] = language.trim().toLowerCase().split("-");
	return TVDB_LANGUAGE_MAP[base] ?? base;
};

const getTranslationRecord = (payload: UnknownRecord | null) => {
	const data = payload?.["data"];
	if (Array.isArray(data)) {
		const primary = data.find((entry) => asRecord(entry)?.["isPrimary"] === true);
		return asRecord(primary ?? data[0]);
	}
	return asRecord(data);
};

export const getTranslationFields = (payload: UnknownRecord | null) => {
	const record = getTranslationRecord(payload);
	return {
		name: record ? stringValue(record["name"]) : null,
		description: record ? stringValue(record["overview"]) : null,
	};
};

export const getLocalizedArtwork = (artworks: unknown, language: string) => {
	const artwork = recordsValue(artworks).find(
		(art) => stringValue(art["language"]) === language && stringValue(art["image"]),
	);
	const image = artwork ? stringValue(artwork["image"]) : null;
	return image ? { type: "remote" as const, url: image } : null;
};

export const buildTranslationResult = (
	translationData: UnknownRecord | null,
	image: RemoteImage | null,
) => {
	const { name, description } = getTranslationFields(translationData);
	const properties: Record<string, string | RemoteImage[]> = {};
	if (description) {
		properties["description"] = description;
	}
	if (image) {
		properties["images"] = [image];
	}
	return {
		...(name ? { name } : {}),
		...(Object.keys(properties).length > 0 ? { properties } : {}),
	};
};

export const collectImages = (mainImages: readonly unknown[], artworks: unknown) => {
	const seen = new Set<string>();
	const images: RemoteImage[] = [];
	const addImage = (value: unknown) => {
		const url = stringValue(value);
		if (url && !seen.has(url)) {
			seen.add(url);
			images.push({ type: "remote", url });
		}
	};

	for (const image of mainImages) {
		addImage(image);
	}
	for (const art of recordsValue(artworks)) {
		addImage(art["image"]);
	}
	return images;
};

export const collectGenres = (genres: unknown) =>
	recordsValue(genres).flatMap((genre) => {
		const name = stringValue(genre["name"]);
		return name ? [name] : [];
	});

const TVDB_COMPANY_ROLES: ReadonlyArray<readonly [string, string]> = [
	["studio", "Studio"],
	["network", "Network"],
	["production", "Production Company"],
	["distributor", "Distributor"],
	["special_effects", "Special Effects"],
];

export const collectCompanies = (companies: unknown) => {
	const companiesRecord = asRecord(companies);
	if (!companiesRecord) {
		return [];
	}

	const companyByKey = new Map<string, RoleRelatedEntity>();
	for (const [key, role] of TVDB_COMPANY_ROLES) {
		for (const company of recordsValue(companiesRecord[key])) {
			const id = numberValue(company["id"]);
			if (id === null) {
				continue;
			}
			const name = stringValue(company["name"]) ?? "Loading...";
			const externalId = String(Math.trunc(id));
			const companyKey = `company.tvdb:${externalId}`;
			const existing = companyByKey.get(companyKey);
			if (existing) {
				existing.relationshipProperties.roles = [
					...new Set([...existing.relationshipProperties.roles, role]),
				];
				if (existing.name === "Loading..." && name !== "Loading...") {
					existing.name = name;
				}
				continue;
			}
			companyByKey.set(companyKey, {
				name,
				externalId,
				providerSlug: "company.tvdb",
				relationshipProperties: { roles: [role] },
			});
		}
	}
	return [...companyByKey.values()];
};

export const collectPeople = (characters: unknown) => {
	const relatedEntityByKey = new Map<string, RoleRelatedEntity>();
	const unlinkedCreators: Array<{ name: string; role: string }> = [];
	const unlinkedByKey = new Set<string>();

	const characterRecords = Array.isArray(characters) ? recordsValue(characters.slice(0, 20)) : [];
	for (const character of characterRecords) {
		const name = stringValue(character["personName"]) ?? "Loading...";
		const role = stringValue(character["peopleType"]) ?? "Cast";
		const peopleId = numberValue(character["peopleId"]);
		if (peopleId === null) {
			const unlinkedKey = `${name}:${role}`;
			if (!unlinkedByKey.has(unlinkedKey)) {
				unlinkedByKey.add(unlinkedKey);
				unlinkedCreators.push({ name, role });
			}
			continue;
		}

		const externalId = String(Math.trunc(peopleId));
		const key = `person.tvdb:${externalId}`;
		const existing = relatedEntityByKey.get(key);
		if (existing) {
			existing.relationshipProperties.roles = [
				...new Set([...existing.relationshipProperties.roles, role]),
			];
			if (existing.name === "Loading..." && name !== "Loading...") {
				existing.name = name;
			}
			continue;
		}
		relatedEntityByKey.set(key, {
			name,
			externalId,
			providerSlug: "person.tvdb",
			relationshipProperties: { roles: [role] },
		});
	}

	return { relatedEntities: [...relatedEntityByKey.values()], unlinkedCreators };
};

export const searchTvdb = (
	host: TvdbHost,
	input: ProviderSearchInput,
	options: {
		readonly type: string;
		readonly nameKeys: readonly string[];
		readonly imageKeys?: readonly string[];
	},
): Effect.Effect<ProviderSearchResult, unknown> => {
	const offset = (input.page - 1) * input.pageSize;
	return tvdbGet(host, "/search", {
		query: input.query,
		type: options.type,
		offset: String(offset),
		limit: String(input.pageSize),
	}).pipe(
		Effect.map((data) => {
			const results = recordsValue(data["data"]);
			const links = asRecord(data["links"]);
			const totalItems = numberValue(links?.["total_items"]) ?? results.length + offset;
			const hasNext = links?.["next"] != null;
			const imageKeys = options.imageKeys ?? ["poster", "image_url"];
			const items = results.flatMap((item) => {
				const id = stringValue(item["tvdb_id"]);
				const title = firstStringValue(item, options.nameKeys);
				if (!id || !title) {
					return [];
				}
				const imageValue = imageKeys.reduce<unknown>((value, key) => value ?? item[key], null);
				const image = stringValue(imageValue);
				return [
					{
						externalId: id,
						titleProperty: { kind: "text" as const, value: title },
						calloutProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
						imageProperty: image
							? { kind: "image" as const, value: { type: "remote" as const, url: image } }
							: { kind: "null" as const, value: null },
					},
				];
			});
			return {
				items,
				details: { totalItems, nextPage: hasNext ? input.page + 1 : null },
			};
		}),
	);
};
