import { defineManifest } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../script-helpers/records";
import { readNextPage, readResults, readTotalItems, vndbPost } from "../vndb-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "VNDB",
	slug: "company.vndb",
	requiredAppConfigKeys: [],
	capabilities: ["httpCall"],
	providerInformation: { source: "vndb" },
});

const PAGE_SIZE = 20;

export const search = defineProviderDriver(manifest, "search", (input, host) =>
	vndbPost(
		host,
		"producer",
		{
			count: true,
			page: input.page,
			results: PAGE_SIZE,
			fields: "id,name",
			filters: ["search", "=", input.query],
		},
		"VNDB producer search request failed",
	).pipe(
		Effect.map((payload) => {
			const items = readResults(payload).flatMap((producer) => {
				const record = asRecord(producer);
				const externalId = stringValue(record?.["id"]);
				const name = stringValue(record?.["name"]);
				if (!externalId || !name) {
					return [];
				}
				return [
					{
						externalId,
						calloutProperty: { kind: "null" as const, value: null },
						titleProperty: { kind: "text" as const, value: name },
						imageProperty: { kind: "null" as const, value: null },
						primarySubtitleProperty: { kind: "null" as const, value: null },
						secondarySubtitleProperty: { kind: "null" as const, value: null },
					},
				];
			});
			return {
				items,
				details: {
					totalItems: readTotalItems(payload),
					nextPage: readNextPage(payload, input.page),
				},
			};
		}),
	),
);

export const details = defineProviderDriver(manifest, "details", (input, host) => {
	if (!/^p\d+$/.test(input.externalId)) {
		throw new Error("externalId must be a VNDB producer ID (e.g., 'p1')");
	}
	return vndbPost(
		host,
		"producer",
		{ fields: "id,name,description,lang,type,aliases", filters: ["id", "=", input.externalId] },
		"VNDB producer details request failed",
	).pipe(
		Effect.map((payload) => {
			const [first] = readResults(payload);
			const producer = asRecord(first);
			if (!producer) {
				throw new Error("VNDB returned no data for this producer externalId");
			}
			const name = stringValue(producer["name"]);
			if (!name) {
				throw new Error("VNDB producer payload is missing name");
			}

			const alternateNames = (
				Array.isArray(producer["aliases"]) ? producer["aliases"] : []
			).flatMap((alias) => {
				const value = stringValue(alias);
				return value ? [value] : [];
			});

			return {
				name,
				properties: {
					images: [],
					alternateNames,
					description: stringValue(producer["description"]),
					sourceUrl: `https://vndb.org/${input.externalId}`,
				},
			};
		}),
	);
});

export default defineProvider({ manifest, drivers: { search, details } });
