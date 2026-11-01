import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { ProviderDetailsRelatedEntity } from "@ryot-app/plugin-backend-sdk/provider";
import { asArray, asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import type { WatchProviderOffer } from "../../../shared/watch-provider";
import type { MediaTrendingProviderOutput } from "../../contracts/workflows";
import { mediaFailureMessage } from "../error-message";
import { MediaSandboxError } from "../failures";
import {
	decodeJsonResponse,
	numberValue,
	recordsValue,
	stringValue,
	type UnknownRecord,
} from "../records";
import { createRoleAccumulator, type RoleRelatedEntity } from "../role-accumulator";

export type TmdbHost = Pick<ScriptHost, "httpCall" | "getPluginConfig">;
export type TmdbTrendingHost = TmdbHost & Pick<ScriptHost, "log" | "upsertGlobalEntities">;

type TmdbImagePurpose = "cover" | "backdrop";
type TmdbRemoteImage = { url: string; type: "remote"; purpose: TmdbImagePurpose };

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

export const getTmdbAccessToken = (host: TmdbHost) =>
	host.getPluginConfig({ required: ["tmdbAccessToken"] }).pipe(
		Effect.map(({ tmdbAccessToken }) => tmdbAccessToken),
		Effect.flatMap((value) => {
			const token = stringValue(value);
			if (!token) {
				return Effect.fail(
					new MediaSandboxError({
						message:
							"TMDB access token is not configured. Set tmdbAccessToken in the plugin configuration.",
					}),
				);
			}
			return Effect.succeed(token);
		}),
	);

export const tmdbGet = (
	host: TmdbHost,
	path: string,
	params: Readonly<Record<string, string>>,
	token: string,
) => {
	const query = new URLSearchParams(params);
	return host
		.httpCall("GET", `${TMDB_BASE_URL}${path}?${query.toString()}`, {
			headers: { Authorization: `Bearer ${token}` },
		})
		.pipe(
			Effect.mapError((error) => ({
				...error,
				message: error.message || `TMDB request failed: ${path}`,
			})),
			Effect.flatMap((response) => decodeJsonResponse(response.body, "TMDB")),
			Effect.flatMap((response) => {
				const payload = asRecord(response);
				if (!payload) {
					return Effect.fail(
						new MediaSandboxError({ message: "TMDB returned an invalid response object" }),
					);
				}
				const statusCode = numberValue(payload["status_code"]);
				if (statusCode !== null && statusCode !== 1) {
					return Effect.fail(
						new MediaSandboxError({
							message:
								stringValue(payload["status_message"]) ?? `TMDB API error (status ${statusCode})`,
						}),
					);
				}
				return Effect.succeed(payload);
			}),
		);
};

export const getImageUrl = (path: unknown) => {
	const value = stringValue(path);
	return value ? `${TMDB_IMAGE_BASE}${value}` : null;
};

export const collectImages = (
	posterPath: unknown,
	backdropPath: unknown,
	posters: unknown,
	backdrops: unknown,
) => {
	const seen = new Set<string>();
	const images: TmdbRemoteImage[] = [];
	const addImage = (path: unknown, purpose: TmdbImagePurpose) => {
		const url = getImageUrl(path);
		if (url && !seen.has(url)) {
			seen.add(url);
			images.push({ url, purpose, type: "remote" });
		}
	};

	addImage(posterPath, "cover");
	for (const image of recordsValue(posters)) {
		addImage(image["file_path"], "cover");
	}
	addImage(backdropPath, "backdrop");
	for (const image of recordsValue(backdrops)) {
		addImage(image["file_path"], "backdrop");
	}
	return images;
};

export const collectGenres = (genres: unknown) => {
	if (genres === undefined || genres === null) {
		return null;
	}
	if (!Array.isArray(genres)) {
		throw new MediaSandboxError({ message: "TMDB genres must be an array" });
	}
	return genres.flatMap((genre) => {
		const name = stringValue(asRecord(genre)?.["name"]);
		return name ? [name] : [];
	});
};

type TmdbWatchProvider = { name: string; image: null | string; offers: WatchProviderOffer[] };
type TmdbWatchProviderCountry = {
	country: string;
	link: null | string;
	providers: TmdbWatchProvider[];
};

const tmdbOfferKeys: ReadonlyArray<readonly [string, WatchProviderOffer]> = [
	["flatrate", "stream"],
	["free", "free"],
	["ads", "ads"],
	["rent", "rent"],
	["buy", "buy"],
];

const collectCountryWatchProviders = (countryOffers: UnknownRecord) => {
	const providers = new Map<string, TmdbWatchProvider>();
	for (const [key, offer] of tmdbOfferKeys) {
		for (const entry of recordsValue(countryOffers[key])) {
			const name = stringValue(entry["provider_name"]);
			if (!name) {
				continue;
			}
			const provider = providers.get(name) ?? {
				name,
				offers: [],
				image: getImageUrl(entry["logo_path"]),
			};
			providers.set(name, provider);
			if (!provider.offers.includes(offer)) {
				provider.offers.push(offer);
			}
		}
	}
	return [...providers.values()];
};

export const collectWatchProviders = (payload: unknown) => {
	const results = asRecord(asRecord(payload)?.["results"]);
	if (!results) {
		return [];
	}
	const countries: TmdbWatchProviderCountry[] = [];
	for (const country of Object.keys(results).sort()) {
		const countryOffers = asRecord(results[country]);
		if (!countryOffers) {
			continue;
		}
		const providers = collectCountryWatchProviders(countryOffers);
		if (providers.length > 0) {
			countries.push({ country, providers, link: stringValue(countryOffers["link"]) });
		}
	}
	return countries;
};

export const collectSuggestions = (
	results: unknown,
	options: { readonly providerSlug: string; readonly nameKeys: readonly string[] },
) => {
	const suggestions = new Map<string, ProviderDetailsRelatedEntity>();
	for (const result of recordsValue(results)) {
		const id = numberValue(result["id"]);
		const name = options.nameKeys.reduce<null | string>(
			(value, key) => value ?? stringValue(result[key]),
			null,
		);
		if (id === null || !name) {
			continue;
		}
		const externalId = String(Math.trunc(id));
		suggestions.set(`${options.providerSlug}:${externalId}`, {
			name,
			externalId,
			providerSlug: options.providerSlug,
		});
	}
	return [...suggestions.values()];
};

export const collectPeople = (
	cast: unknown,
	crew: unknown,
	createdBy?: unknown,
	options: {
		readonly guestStarInventoryComplete?: boolean;
		readonly currentRegularCast?: ReadonlySet<string>;
		readonly guestStarAppearances?: ReadonlyMap<string, number>;
	} = {},
) => {
	const related = createRoleAccumulator();
	const addPerson = (
		person: UnknownRecord,
		role: string,
		creditOptions: {
			readonly isGuest?: boolean;
			readonly order?: null | number;
			readonly character?: null | string;
			readonly department?: null | string;
			readonly creditKind?: "cast" | "crew";
		} = {},
	) => {
		const name = stringValue(person["name"]) ?? "Loading...";
		const id = numberValue(person["id"]);
		if (id === null) {
			return;
		}
		const character = stringValue(creditOptions.character);
		const externalId = String(Math.trunc(id));
		related.add({
			name,
			externalId,
			providerSlug: "person.tmdb",
			relationshipProperties: {
				roles: [role],
				...(character === null ? {} : { character }),
				...(creditOptions.order === null || creditOptions.order === undefined
					? {}
					: { order: Math.trunc(creditOptions.order) }),
				...(creditOptions.creditKind === undefined
					? {}
					: { creditKinds: [creditOptions.creditKind] }),
				...(creditOptions.department ? { departments: [creditOptions.department] } : {}),
				...(creditOptions.isGuest === undefined ? {} : { isGuest: creditOptions.isGuest }),
				...(character === null ? {} : { isUncredited: /\(uncredited\)\s*$/i.test(character) }),
			},
		});
	};

	for (const creator of recordsValue(createdBy)) {
		addPerson(creator, "Creator", { creditKind: "crew" });
	}
	for (const [index, member] of recordsValue(cast).entries()) {
		const id = numberValue(member["id"]);
		const externalId = id === null ? null : String(Math.trunc(id));
		const order = numberValue(member["order"]);
		const aggregateRoles = recordsValue(member["roles"]);
		const roles = aggregateRoles.length > 0 ? aggregateRoles : [member];
		for (const castRole of roles) {
			const character = stringValue(castRole["character"]) ?? stringValue(member["character"]);
			const totalEpisodeCount = numberValue(member["total_episode_count"]);
			const guestCount = externalId
				? (options.guestStarAppearances?.get(externalId) ??
					(options.guestStarInventoryComplete ? 0 : undefined))
				: undefined;
			const isRegular = externalId ? options.currentRegularCast?.has(externalId) === true : false;
			let isGuest: boolean | undefined;
			if (isRegular) {
				isGuest = false;
			} else if (totalEpisodeCount !== null && totalEpisodeCount > 0 && guestCount !== undefined) {
				if (guestCount >= totalEpisodeCount) {
					isGuest = true;
				} else if (options.guestStarInventoryComplete) {
					isGuest = false;
				}
			}
			const guestClassification =
				isGuest ?? (externalId && options.guestStarAppearances === undefined ? false : undefined);
			addPerson(member, "Acting", {
				character,
				creditKind: "cast",
				department: "Acting",
				order: order ?? index,
				...(guestClassification === undefined ? {} : { isGuest: guestClassification }),
			});
		}
	}
	for (const member of recordsValue(crew)) {
		const listedJobs = recordsValue(member["jobs"]);
		const jobs = listedJobs.length > 0 ? listedJobs : [member];
		for (const crewJob of jobs) {
			const job = stringValue(crewJob["job"]) ?? "Crew";
			addPerson(member, job, {
				creditKind: "crew",
				department: stringValue(member["department"]) ?? stringValue(crewJob["department"]),
			});
		}
	}
	return related.entities;
};

export const collectCompanies = (companyGroups: ReadonlyArray<readonly [unknown, string]>) => {
	const companies = new Map<string, RoleRelatedEntity>();
	const addCompany = (company: UnknownRecord, role: string) => {
		const idValue = numberValue(company["id"]);
		if (idValue === null) {
			return;
		}
		const id = Math.trunc(idValue);
		const name = stringValue(company["name"]) ?? "Loading...";
		const key = `company.tmdb:${id}`;
		const existing = companies.get(key);
		if (existing) {
			existing.relationshipProperties.roles = [
				...new Set([...existing.relationshipProperties.roles, role]),
			];
			if (existing.name === "Loading..." && name !== "Loading...") {
				existing.name = name;
			}
			return;
		}
		companies.set(key, {
			name,
			externalId: String(id),
			providerSlug: "company.tmdb",
			relationshipProperties: { roles: [role] },
		});
	};
	for (const [companiesList, role] of companyGroups) {
		for (const company of recordsValue(companiesList)) {
			addCompany(company, role);
		}
	}
	return [...companies.values()];
};

const fetchTrendingItems = (
	host: TmdbHost,
	path: string,
	language: string,
	token: string,
	options: { readonly providerSlug: string; readonly nameKeys: readonly string[] },
) =>
	Effect.gen(function* () {
		const results: unknown[] = [];
		for (const page of [1, 2, 3]) {
			const data = yield* tmdbGet(host, path, { language, page: String(page) }, token);
			results.push(...asArray(data["results"]));
		}
		return collectSuggestions(results, options).map(({ name, externalId }) => ({
			name,
			externalId,
		}));
	});

export const runTmdbTrending = (
	host: TmdbTrendingHost,
	options: {
		readonly path: string;
		readonly language: string;
		readonly providerSlug: string;
		readonly entitySchemaSlug: string;
		readonly nameKeys: readonly string[];
	},
) =>
	Effect.gen(function* () {
		const items = yield* getTmdbAccessToken(host).pipe(
			Effect.flatMap((token) =>
				fetchTrendingItems(host, options.path, options.language, token, {
					nameKeys: options.nameKeys,
					providerSlug: options.providerSlug,
				}),
			),
			Effect.catch((error) =>
				host
					.log([
						{
							level: "warning",
							message: "trending provider skipped",
							attributes: { error: mediaFailureMessage(error), providerSlug: options.providerSlug },
						},
					])
					.pipe(
						Effect.orElseSucceed(() => null),
						Effect.as(null),
					),
			),
		);
		if (items === null) {
			return { status: "failed" } satisfies typeof MediaTrendingProviderOutput.Type;
		}
		const results = yield* host.upsertGlobalEntities(
			items.map(({ name, externalId }) => ({
				name,
				externalId,
				properties: {},
				populatedAt: null,
				entitySchemaSlug: options.entitySchemaSlug,
			})),
		);
		return {
			status: "fetched",
			entityIds: [
				...new Set(
					results.flatMap((result) => (result.status === "upserted" ? [result.entityId] : [])),
				),
			],
		} satisfies typeof MediaTrendingProviderOutput.Type;
	});

export const parseTranslationLanguage = (language: string) => {
	const [languagePart = "", regionPart] = language.split("-");
	return {
		langCode: languagePart.trim().toLowerCase(),
		region: regionPart ? regionPart.trim().toUpperCase() : null,
	};
};

export const orderedTranslationCandidates = (
	translationsData: UnknownRecord,
	langCode: string,
	region: null | string,
) => {
	const candidates = recordsValue(translationsData["translations"]).filter(
		(entry) => stringValue(entry["iso_639_1"])?.toLowerCase() === langCode,
	);
	const regionMatch = region
		? candidates.find((entry) => stringValue(entry["iso_3166_1"])?.toUpperCase() === region)
		: null;
	return regionMatch
		? [regionMatch, ...candidates.filter((entry) => entry !== regionMatch)]
		: candidates;
};

export const firstTranslationValue = (
	candidates: readonly UnknownRecord[],
	extract: (data: UnknownRecord) => unknown,
) => {
	for (const entry of candidates) {
		const data = asRecord(entry["data"]);
		const value = data ? stringValue(extract(data)) : null;
		if (value) {
			return value;
		}
	}
	return null;
};

export const getLocalizedImageUrl = (
	imagesData: UnknownRecord,
	imageKey: string,
	langCode: string,
) => {
	const localizedImage = recordsValue(imagesData[imageKey]).find(
		(image) => stringValue(image["iso_639_1"])?.toLowerCase() === langCode,
	);
	return localizedImage ? getImageUrl(localizedImage["file_path"]) : null;
};
