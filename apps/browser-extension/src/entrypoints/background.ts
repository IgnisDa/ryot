import { isFiniteNumber } from "@ryot/ts-utils/lodash";

import { storage } from "#imports";

import { MESSAGE_TYPES, STORAGE_KEYS } from "../lib/constants";
import { lookupMetadata, postIntegrationWebhook } from "../lib/contract-client";
import type { ProgressDataWithMetadata } from "../lib/extension-types";
import { ExtensionStatus } from "../lib/extension-types";
import { logger } from "../lib/logger";

async function handleMetadataLookup(data: { title: string }) {
	const integrationUrl = await storage.getItem<string>(STORAGE_KEYS.INTEGRATION_URL);

	if (!integrationUrl) {
		throw new Error("Integration URL not found in storage");
	}

	logger.debug("Making metadata lookup request", {
		title: data.title,
		url: integrationUrl,
	});

	const result = await lookupMetadata(integrationUrl, data.title);

	logger.debug("Metadata lookup response", { result });

	return result;
}

async function handleProgressData(progressData: ProgressDataWithMetadata, tabUrl?: string) {
	try {
		const integrationUrl = await storage.getItem<string>(STORAGE_KEYS.INTEGRATION_URL);

		if (!integrationUrl) {
			throw new Error("Integration URL not found in storage");
		}

		const { rawData, metadata } = progressData;

		if (!isFiniteNumber(rawData.progress) || !tabUrl || metadata.status === "notFound") {
			return undefined;
		}

		const mediaSeen = {
			lot: metadata.data.lot,
			progress: rawData.progress,
			identifier: metadata.data.identifier,
			...(metadata.showInformation
				? {
						show_season_number: metadata.showInformation.season,
						show_episode_number: metadata.showInformation.episode,
					}
				: {}),
		};

		const integrationPayload = {
			url: tabUrl,
			data: mediaSeen,
		};

		logger.debug("Sending integration data", {
			url: integrationUrl,
			payload: integrationPayload,
		});

		await postIntegrationWebhook(integrationUrl, integrationPayload);

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
	const status = await storage.getItem<ExtensionStatus>(STORAGE_KEYS.EXTENSION_STATUS);
	return status ?? ExtensionStatus.Idle;
}

async function getCurrentCachedTitle() {
	const title = await storage.getItem<string>(STORAGE_KEYS.CURRENT_PAGE_TITLE);
	return title ?? null;
}

export default defineBackground(() => {
	logger.info("Background script initialized");

	self.addEventListener("beforeunload", () => {
		logger.cleanup();
	});

	browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.type === MESSAGE_TYPES.GET_STATUS) {
			getCurrentStatus()
				.then((status) => {
					sendResponse({ success: true, data: status });
					return;
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
					return;
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
					return;
				})
				.catch((error) => {
					logger.debug("Metadata lookup failed", { error });
					sendResponse({ success: false, error: error.message });
				});

			return true;
		}

		if (message.type === MESSAGE_TYPES.GET_CACHED_TITLE) {
			getCurrentCachedTitle()
				.then((title) => {
					sendResponse({ success: true, data: title });
					return;
				})
				.catch((error) => {
					logger.debug("Failed to get cached title", { error });
					sendResponse({ success: false, error: error.message });
				});

			return true;
		}

		return undefined;
	});
});
