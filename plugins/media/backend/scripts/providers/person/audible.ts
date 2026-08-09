import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider } from "@ryot-app/sandbox-sdk/provider";

import { asRecord, stringValue } from "../../../shared/records";
import { audibleFetchJson } from "../audible-shared";

export const manifest = defineManifest({
	kind: "provider",
	name: "Audible",
	slug: "person.audible",
	capabilities: ["httpCall"],
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

const AUTHORS_URL = "https://api.audnex.us/authors";

export const search = defineProvider({
	manifest,
	operation: "search",
	run: (input, host) => {
		const params = new URLSearchParams({ name: input.query, region: "us" });
		return audibleFetchJson(
			host,
			`${AUTHORS_URL}?${params.toString()}`,
			"Audnex author search request failed",
			"Audnex",
		).pipe(
			Effect.map((payloadValue) => {
				const allItems = Array.isArray(payloadValue) ? payloadValue : [];
				const totalItems = allItems.length;
				const startIndex = (input.page - 1) * input.pageSize;
				const endIndex = Math.min(startIndex + input.pageSize, totalItems);
				const items = allItems.slice(startIndex, endIndex).flatMap((author) => {
					const record = asRecord(author);
					const externalId = stringValue(record?.["asin"]);
					const name = stringValue(record?.["name"]);
					if (!externalId || !name) {
						return [];
					}
					return [{ externalId, title: name }];
				});
				return {
					items,
					details: { totalItems, nextPage: endIndex < totalItems ? input.page + 1 : null },
				};
			}),
		);
	},
});

export const details = defineProvider({
	manifest,
	operation: "details",
	run: (input, host) => {
		const params = new URLSearchParams({ region: "us" });
		return audibleFetchJson(
			host,
			`${AUTHORS_URL}/${input.externalId}?${params.toString()}`,
			"Audnex author details request failed",
			"Audnex",
		).pipe(
			Effect.map((payloadValue) => {
				const record = asRecord(payloadValue);
				const name = stringValue(record?.["name"]);
				if (!name) {
					throw new Error("Audnex returned no author name");
				}
				const image = stringValue(record?.["image"]);
				const description =
					typeof record?.["description"] === "string" ? record["description"] : null;
				return {
					name,
					properties: {
						description,
						alternateNames: [],
						sourceUrl: `https://www.audible.com/author/${input.externalId}`,
						images: image
							? [{ type: "remote" as const, url: image, purpose: "profile" as const }]
							: [],
					},
				};
			}),
		);
	},
});
