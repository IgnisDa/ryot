import { MetadataLookupDocument } from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";
import { storage } from "#imports";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../lib/constants";
import type { MetadataLookupData, RawMediaData } from "../lib/extension-types";

function extractGraphQLEndpoint(integrationUrl: string) {
	try {
		const url = new URL(integrationUrl);
		return `${url.origin}/backend/graphql`;
	} catch (_error) {
		throw new Error(`Invalid integration URL: ${integrationUrl}`);
	}
}

export default defineBackground(() => {
	console.log("[RYOT] Background script initialized");

	browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		if (message.type === MESSAGE_TYPES.SEND_PROGRESS_DATA) {
			handleProgressData(message.data)
				.then((result) => {
					sendResponse({ success: true, result });
				})
				.catch((error) => {
					console.error("[RYOT] Progress data request failed:", error);
					sendResponse({ success: false, error: error.message });
				});

			return true;
		}

		if (message.type === MESSAGE_TYPES.METADATA_LOOKUP) {
			handleMetadataLookup(message.data)
				.then((result) => {
					sendResponse({ success: true, data: result });
				})
				.catch((error) => {
					console.error("[RYOT] Metadata lookup failed:", error);
					sendResponse({ success: false, error: error.message });
				});

			return true;
		}
	});

	async function handleMetadataLookup(data: {
		title: string;
	}) {
		const integrationUrl = await storage.getItem<string>(
			STORAGE_KEYS.INTEGRATION_URL,
		);

		if (!integrationUrl) {
			throw new Error("Integration URL not found in storage");
		}

		const graphqlEndpoint = extractGraphQLEndpoint(integrationUrl);
		const client = new GraphQLClient(graphqlEndpoint);

		console.log("[RYOT] Making metadata lookup request to:", graphqlEndpoint);
		console.log("[RYOT] With title:", data.title);

		const result = await client.request(MetadataLookupDocument, {
			title: data.title,
		});

		console.log("[RYOT] Metadata lookup response:", result);

		return result.metadataLookup;
	}

	async function handleProgressData(data: RawMediaData) {
		try {
			const integrationUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);

			if (!integrationUrl) {
				throw new Error("Integration URL not found in storage");
			}

			console.log("[RYOT] Sending progress data to:", integrationUrl);
			console.log("[RYOT] Progress data:", data);

			const response = await fetch(integrationUrl, {
				method: "POST",
				body: JSON.stringify(data),
				headers: { "Content-Type": "application/json" },
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			console.log("[RYOT] Progress data sent successfully");

			return {
				success: true,
			};
		} catch (error) {
			console.error("[RYOT] Progress data request failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}
});
