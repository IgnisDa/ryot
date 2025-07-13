import { MetadataLookupDocument } from "@ryot/generated/graphql/backend/graphql";
import { GraphQLClient } from "graphql-request";
import { storage } from "#imports";
import { MESSAGE_TYPES, STORAGE_KEYS } from "../lib/constants";
import type {
	ExtensionStatus,
	ProgressDataWithMetadata,
} from "../lib/extension-types";
import { logger } from "../lib/logger";

function extractGraphQLEndpoint(integrationUrl: string) {
	try {
		const url = new URL(integrationUrl);
		return `${url.origin}/backend/graphql`;
	} catch (_error) {
		throw new Error(`Invalid integration URL: ${integrationUrl}`);
	}
}

export default defineBackground(() => {
	logger.info("Background script initialized");

	browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.type === MESSAGE_TYPES.GET_STATUS) {
			getCurrentStatus()
				.then((status) => {
					sendResponse({ success: true, data: status });
				})
				.catch((error) => {
					logger.debug("Failed to get status", { error });
					sendResponse({ success: false, error: error.message });
				});

			return true;
		}

		if (message.type === MESSAGE_TYPES.SEND_PROGRESS_DATA) {
			handleProgressData(message.data, sender.tab?.url)
				.then((result) => {
					sendResponse({ success: true, result });
				})
				.catch((error) => {
					logger.debug("Progress data request failed", { error });
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
					logger.debug("Metadata lookup failed", { error });
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

		logger.debug("Making metadata lookup request", {
			endpoint: graphqlEndpoint,
			title: data.title,
		});

		const result = await client.request(MetadataLookupDocument, {
			title: data.title,
		});

		logger.debug("Metadata lookup response", { result });

		return result.metadataLookup;
	}

	async function handleProgressData(
		progressData: ProgressDataWithMetadata,
		tabUrl?: string,
	) {
		try {
			const integrationUrl = await storage.getItem<string>(
				STORAGE_KEYS.INTEGRATION_URL,
			);

			if (!integrationUrl) {
				throw new Error("Integration URL not found in storage");
			}

			const { rawData, metadata } = progressData;

			if (!rawData.progress) {
				throw new Error("No progress data available");
			}

			if (!tabUrl) {
				throw new Error("Tab URL not available");
			}

			const integrationPayload = {
				url: tabUrl,
				data: {
					progress: rawData.progress,
					identifier: metadata.data.identifier,
					lot: metadata.data.lot.toLowerCase(),
					show_season_number: metadata.showInformation?.season,
					show_episode_number: metadata.showInformation?.episode,
				},
			};

			logger.debug("Sending integration data", {
				url: integrationUrl,
				payload: integrationPayload,
			});

			await fetch(integrationUrl, {
				method: "POST",
				body: JSON.stringify(integrationPayload),
				headers: { "Content-Type": "application/json" },
			});

			logger.info("Integration data sent successfully");

			return { success: true };
		} catch (error) {
			logger.error("Integration data request failed", { error });
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async function getCurrentStatus() {
		const status = await storage.getItem<ExtensionStatus>(
			STORAGE_KEYS.EXTENSION_STATUS,
		);
		return status || { state: "idle", message: "Nothing to do..." };
	}
});
