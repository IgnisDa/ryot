import { defineManifest } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import {
	asRecord,
	getKeySegment,
	loadOpenLibraryJson,
	parseDescription,
	stringValue,
} from "../openlibrary-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "OpenLibrary",
	requiredAppConfigKeys: [],
	slug: "person.openlibrary",
	capabilities: ["httpCall"],
	providerInformation: { source: "openlibrary" },
});

const trimmedOrNull = (value: unknown) => (typeof value === "string" ? value.trim() : null);

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	const requestedIdentifier = getKeySegment(input.externalId);
	if (!requestedIdentifier) {
		throw new Error("externalId is required");
	}
	return loadOpenLibraryJson(
		host,
		`https://openlibrary.org/authors/${requestedIdentifier}.json`,
		"OpenLibrary author",
	).then((payloadValue) => {
		const authorPayload = asRecord(payloadValue);
		const name = stringValue(authorPayload?.["name"]);
		if (!name) {
			throw new Error("OpenLibrary author payload is missing name");
		}

		const alternateNames: string[] = [];
		const addAlternateName = (value: unknown) => {
			if (typeof value !== "string") {
				return;
			}
			const trimmed = value.trim();
			if (trimmed && !alternateNames.includes(trimmed)) {
				alternateNames.push(trimmed);
			}
		};
		addAlternateName(authorPayload?.["personal_name"]);
		const alternateNamesValue = authorPayload?.["alternate_names"];
		for (const alternateName of Array.isArray(alternateNamesValue) ? alternateNamesValue : []) {
			addAlternateName(alternateName);
		}

		const links = authorPayload?.["links"];
		const website =
			(Array.isArray(links) ? links : [])
				.map((link) => stringValue(asRecord(link)?.["url"]))
				.find((url) => url) ?? null;

		return {
			name,
			properties: {
				website,
				images: [],
				alternateNames,
				birthDate: trimmedOrNull(authorPayload?.["birth_date"]),
				deathDate: trimmedOrNull(authorPayload?.["death_date"]),
				description: parseDescription(authorPayload?.["bio"]),
				sourceUrl: `https://openlibrary.org/authors/${requestedIdentifier}`,
			},
		};
	});
});

export default defineProvider({ manifest, drivers: { details } });
