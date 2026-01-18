import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import type { ProviderDetailsRelatedEntity } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	numberValue,
	parseJsonResponse,
	recordsValue,
	stringValue,
	type UnknownRecord,
} from "../script-helpers/records";
import type { RoleRelatedEntity } from "../script-helpers/role-accumulator";

export type TmdbHost = SandboxHost<readonly ["httpCall", "getAppConfigValue"]>;

export type TmdbUserHost = SandboxHost<
	readonly ["httpCall", "getAppConfigValue", "getUserPreferences"]
>;

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/original";

export const getTmdbAccessToken = (host: TmdbHost) =>
	host.getAppConfigValue("moviesAndShows.tmdbAccessToken").pipe(
		Effect.map((value) => {
			const token = stringValue(value);
			if (!token) {
				throw new Error(
					"TMDB access token is not configured. Set MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN in your environment.",
				);
			}
			return token;
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
			Effect.mapError((error) => new Error(error.message || `TMDB request failed: ${path}`)),
			Effect.map((response) => {
				const payload = asRecord(parseJsonResponse(response.body, "TMDB"));
				if (!payload) {
					throw new Error("TMDB returned an invalid response object");
				}
				const statusCode = numberValue(payload["status_code"]);
				if (statusCode !== null && statusCode !== 1) {
					throw new Error(
						stringValue(payload["status_message"]) ?? `TMDB API error (status ${statusCode})`,
					);
				}
				return payload;
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
	const images: Array<{ type: "remote"; url: string }> = [];
	const addImage = (path: unknown) => {
		const url = getImageUrl(path);
		if (url && !seen.has(url)) {
			seen.add(url);
			images.push({ type: "remote", url });
		}
	};

	addImage(posterPath);
	addImage(backdropPath);
	for (const image of recordsValue(posters)) {
		addImage(image["file_path"]);
	}
	for (const image of recordsValue(backdrops)) {
		addImage(image["file_path"]);
	}
	return images;
};

export const collectGenres = (genres: unknown) =>
	recordsValue(genres).flatMap((genre) => {
		const name = stringValue(genre["name"]);
		return name ? [name] : [];
	});

export const collectSuggestions = (
	results: unknown,
	options: { readonly nameKeys: readonly string[]; readonly scriptSlug: string },
) => {
	const suggestions = new Map<string, ProviderDetailsRelatedEntity>();
	for (const result of recordsValue(results)) {
		const id = numberValue(result["id"]);
		const name = options.nameKeys.reduce<string | null>(
			(value, key) => value ?? stringValue(result[key]),
			null,
		);
		if (id === null || !name) {
			continue;
		}
		const externalId = String(Math.trunc(id));
		suggestions.set(`${options.scriptSlug}:${externalId}`, {
			name,
			externalId,
			scriptSlug: options.scriptSlug,
		});
	}
	return [...suggestions.values()];
};

export const collectPeople = (cast: unknown, crew: unknown, createdBy?: unknown) => {
	const relatedEntities = new Map<string, RoleRelatedEntity>();
	const unlinkedCreators: Array<{ name: string; role: string }> = [];
	const unlinkedKeys = new Set<string>();
	const addRelatedEntity = (relatedEntity: RoleRelatedEntity) => {
		const key = `${relatedEntity.scriptSlug}:${relatedEntity.externalId}`;
		const existing = relatedEntities.get(key);
		if (!existing) {
			relatedEntities.set(key, relatedEntity);
			return;
		}
		existing.relationshipProperties.roles = [
			...new Set([
				...existing.relationshipProperties.roles,
				...relatedEntity.relationshipProperties.roles,
			]),
		];
		if (existing.name === "Loading..." && relatedEntity.name !== "Loading...") {
			existing.name = relatedEntity.name;
		}
	};
	const addUnlinkedCreator = (name: string, role: string) => {
		const key = `${name}:${role}`;
		if (!unlinkedKeys.has(key)) {
			unlinkedKeys.add(key);
			unlinkedCreators.push({ name, role });
		}
	};
	const addPerson = (person: UnknownRecord, role: string) => {
		const name = stringValue(person["name"]) ?? "Loading...";
		const id = numberValue(person["id"]);
		if (id === null) {
			addUnlinkedCreator(name, role);
			return;
		}
		addRelatedEntity({
			name,
			scriptSlug: "person.tmdb",
			relationshipProperties: { roles: [role] },
			externalId: String(Math.trunc(id)),
		});
	};

	for (const creator of recordsValue(createdBy)) {
		addPerson(creator, "Creator");
	}
	for (const member of recordsValue(cast).slice(0, 15)) {
		addPerson(member, stringValue(member["known_for_department"]) ?? "Acting");
	}
	const notableJobs = new Set(["Director", "Producer", "Screenplay", "Writer", "Story"]);
	for (const member of recordsValue(crew)) {
		const job = stringValue(member["job"]);
		if (job && notableJobs.has(job)) {
			addPerson(member, job);
		}
	}
	return { relatedEntities: [...relatedEntities.values()], unlinkedCreators };
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
			scriptSlug: "company.tmdb",
			externalId: String(id),
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

export const fetchTrendingItems = (
	host: TmdbHost,
	path: string,
	language: string,
	token: string,
	options: { readonly nameKeys: readonly string[]; readonly scriptSlug: string },
) =>
	[1, 2, 3]
		.reduce<Effect.Effect<unknown[], unknown>>(
			(result, page) =>
				result.pipe(
					Effect.flatMap((items) =>
						tmdbGet(host, path, { language, page: String(page) }, token).pipe(
							Effect.map((data) => {
								const pageResults = data["results"];
								return Array.isArray(pageResults) ? [...items, ...pageResults] : items;
							}),
						),
					),
				),
			Effect.succeed([]),
		)
		.pipe(
			Effect.map((results) =>
				collectSuggestions(results, options).map(({ name, externalId }) => ({ name, externalId })),
			),
		);

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
	region: string | null,
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
