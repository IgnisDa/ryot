import { defineManifest } from "@ryot/sandbox-sdk";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	getIdentifier,
	loadMetronJson,
	numberValue,
	stringValue,
} from "../metron-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Metron",
	slug: "person.metron",
	providerInformation: { source: "metron" },
	capabilities: ["httpCall", "getAppConfigValue"],
	requiredAppConfigKeys: ["providers.metronUsername", "providers.metronPassword"],
});

const parseYear = (value: unknown) => {
	const date = stringValue(value);
	if (!date) {
		return null;
	}
	const parsed = dayjs(date);
	return parsed.isValid() ? parsed.year() : null;
};

export const search = defineProviderDriver(manifest, "search", (input, host) => {
	const params = new URLSearchParams({
		name: input.query,
		page: String(input.page),
		page_size: String(input.pageSize),
	});
	return loadMetronJson(
		host,
		`https://metron.cloud/api/creator/?${params.toString()}`,
		"Metron creator search request failed",
	).then((payloadValue) => {
		const payload = asRecord(payloadValue);
		const count = numberValue(payload?.["count"]);
		const totalItems = count === null ? 0 : Math.max(0, Math.trunc(count));
		const results = payload?.["results"];
		const items = (Array.isArray(results) ? results : []).flatMap((creator) => {
			const record = asRecord(creator);
			const externalId = getIdentifier(record?.["id"]);
			const name = stringValue(record?.["name"]);
			if (!externalId || !name) {
				return [];
			}
			const image = stringValue(record?.["image"]);
			const birthYear = parseYear(record?.["birth"]);
			return [
				{
					externalId,
					calloutProperty: { kind: "null" as const, value: null },
					titleProperty: { kind: "text" as const, value: name },
					secondarySubtitleProperty: { kind: "null" as const, value: null },
					primarySubtitleProperty:
						birthYear === null
							? { kind: "null" as const, value: null }
							: { kind: "number" as const, value: birthYear },
					imageProperty:
						image === null
							? { kind: "null" as const, value: null }
							: { kind: "image" as const, value: { type: "remote" as const, url: image } },
				},
			];
		});
		return {
			items,
			details: {
				totalItems,
				nextPage: input.page * input.pageSize < totalItems ? input.page + 1 : null,
			},
		};
	});
});

export const details = defineProviderDriver(manifest, "details", (input, host) =>
	loadMetronJson(
		host,
		`https://metron.cloud/api/creator/${encodeURIComponent(input.externalId)}/`,
		"Metron creator details request failed",
	).then((payloadValue) => {
		const payload = asRecord(payloadValue);
		const name = stringValue(payload?.["name"]);
		if (!name) {
			throw new Error("Metron creator payload is missing name");
		}
		const image = stringValue(payload?.["image"]);
		return {
			name,
			properties: {
				alternateNames: [],
				birthDate: stringValue(payload?.["birth"]),
				deathDate: stringValue(payload?.["death"]),
				description: stringValue(payload?.["desc"]),
				sourceUrl: `https://metron.cloud/creator/${input.externalId}`,
				images: image ? [{ type: "remote" as const, url: image }] : [],
			},
		};
	}),
);

export default defineProvider({ manifest, drivers: { search, details } });
