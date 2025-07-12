import {
	MetadataLookupDocument,
	type MetadataLookupQuery,
} from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";
import { storage } from "#imports";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../lib/constants";
import type { RawMediaData } from "../types/progress";

function extractGraphQLEndpoint(integrationUrl: string): string {
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
					console.error("[RYOT] GraphQL request failed:", error);
					sendResponse({ success: false, error: error.message });
				});

			return true;
		}
	});

	async function handleProgressData(data: RawMediaData): Promise<{
		success: boolean;
		data?: MetadataLookupQuery["metadataLookup"];
		error?: string;
	}> {
		try {
			const integrationUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);

			if (!integrationUrl) {
				throw new Error("Integration URL not found in storage");
			}

			const graphqlEndpoint = extractGraphQLEndpoint(integrationUrl);
			const client = new GraphQLClient(graphqlEndpoint);

			console.log("[RYOT] Making GraphQL request to:", graphqlEndpoint);
			console.log("[RYOT] With title:", data.title);

			const result = await client.request(MetadataLookupDocument, {
				title: data.title,
			});

			console.log("[RYOT] GraphQL response:", result);

			return {
				success: true,
				data: result.metadataLookup,
			};
		} catch (error) {
			console.error("[RYOT] GraphQL request failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}
});
