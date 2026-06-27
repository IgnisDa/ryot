import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, numberValue, recordsValue, stringValue } from "../../script-helpers/records";
import { searchTvdb, tvdbGet } from "../tvdb-shared";

export const manifest = defineManifest({
	name: "TVDB",
	kind: "provider",
	slug: "company.tvdb",
	providerInformation: { source: "tvdb" },
	requiredAppConfigKeys: ["providers.tvdbApiKey"],
	capabilities: ["httpCall", "getCachedValue", "setCachedValue", "getAppConfigValue"],
});

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	searchTvdb(host, input, {
		type: "company",
		nameKeys: ["name"],
		imageKeys: ["poster", "image_url", "primaryImage"],
	}),
);

const getAliasName = (alias: unknown) => {
	const record = asRecord(alias);
	if (record && typeof record["name"] === "string") {
		return record["name"].trim();
	}
	if (typeof alias === "string") {
		return alias.trim();
	}
	return "";
};

const toMediaEntities = (items: unknown, scriptSlug: string) =>
	recordsValue(items).flatMap((item) => {
		const rawId = item["id"] ?? item["tvdb_id"];
		const numeric = numberValue(rawId);
		const externalId = numeric !== null ? String(Math.trunc(numeric)) : stringValue(rawId);
		if (externalId === null) {
			return [];
		}
		const name = stringValue(item["name"]) ?? stringValue(item["title"]) ?? "Loading...";
		return [
			{
				externalId,
				scriptSlug,
				name,
				relationshipProperties: { roles: ["Company"] },
			},
		];
	});

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a numeric TVDB company ID");
	}
	return tvdbGet(host, `/companies/${input.externalId}`).then((data) => {
		const company = asRecord(data["data"]);
		if (!company) {
			throw new Error("TVDB returned no data for this company");
		}
		const name = stringValue(company["name"]);
		if (!name) {
			throw new Error("TVDB returned no name for this company");
		}
		const primaryImage = stringValue(company["primaryImage"]);
		const images = primaryImage ? [{ type: "remote" as const, url: primaryImage }] : [];
		const alternateNames = Array.isArray(company["aliases"])
			? company["aliases"].map(getAliasName).filter((alias) => alias.length > 0)
			: [];
		const headquarters = stringValue(company["country"]);
		const movieEntities = toMediaEntities(company["movies"], "movie.tvdb");
		const showEntities = toMediaEntities(company["series"], "show.tvdb");
		return {
			name,
			properties: { images, headquarters, alternateNames },
			relatedEntityGroups: [
				{
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					entities: movieEntities,
					relationshipSchemaSlug: "company-to-movie",
				},
				{
					direction: "outgoing" as const,
					synchronization: "authoritative" as const,
					entities: showEntities,
					relationshipSchemaSlug: "company-to-show",
				},
			],
		};
	});
});

export default defineProvider({ manifest, drivers: { search, details } });
