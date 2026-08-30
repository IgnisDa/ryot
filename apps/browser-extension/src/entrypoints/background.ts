import { isFiniteNumber } from "@ryot-app/ts-utils/lodash";
import { Effect } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/unstable/http";

import { storage } from "#imports";

import { MESSAGE_TYPES, STORAGE_KEYS } from "../lib/constants";
import { lookupMetadata, postIntegrationWebhook } from "../lib/contract-client";
import type { ProgressDataWithMetadata } from "../lib/extension-types";
import { ExtensionStatus } from "../lib/extension-types";
import { logger } from "../lib/logger";
import { errorMessage, fromPlatform } from "../lib/platform";

const handleMetadataLookup = Effect.fn("handleMetadataLookup")(function* (data: { title: string }) {
	const integrationUrl = yield* fromPlatform(() =>
		storage.getItem<string>(STORAGE_KEYS.INTEGRATION_URL),
	);

	if (!integrationUrl) {
		throw new Error("Integration URL not found in storage");
	}

	logger.debug("Making metadata lookup request", { title: data.title, url: integrationUrl });

	const result = yield* lookupMetadata(integrationUrl, data.title);

	logger.debug("Metadata lookup response", { result });

	return result;
});

const handleProgressData = (progressData: ProgressDataWithMetadata, tabUrl?: string) =>
	Effect.gen(function* () {
		const integrationUrl = yield* fromPlatform(() =>
			storage.getItem<string>(STORAGE_KEYS.INTEGRATION_URL),
		);

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

		const integrationPayload = { url: tabUrl, data: mediaSeen };

		logger.debug("Sending integration data", { url: integrationUrl, payload: integrationPayload });

		yield* postIntegrationWebhook(integrationUrl, integrationPayload);

		logger.info("Integration data sent successfully");

		return { success: true };
	}).pipe(
		Effect.catchCause((cause) => {
			logger.error("Integration data request failed", { error: cause });
			return Effect.succeed({ success: false, error: errorMessage(cause) });
		}),
	);

const getCurrentStatus = () =>
	fromPlatform(() => storage.getItem<ExtensionStatus>(STORAGE_KEYS.EXTENSION_STATUS)).pipe(
		Effect.map((status) => status ?? ExtensionStatus.Idle),
	);

const getCurrentCachedTitle = () =>
	fromPlatform(() => storage.getItem<string>(STORAGE_KEYS.CURRENT_PAGE_TITLE)).pipe(
		Effect.map((title) => title ?? null),
	);

export default defineBackground(() => {
	logger.info("Background script initialized");

	self.addEventListener("beforeunload", () => {
		logger.cleanup();
	});

	browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
		const respond = <A, E>(
			program: Effect.Effect<A, E, HttpClient.HttpClient>,
			label: string,
			makeResponse: (result: A) => unknown,
		) => {
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each runtime message is a background entrypoint
			void Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer))).then(
				(result) => sendResponse(makeResponse(result)),
				(error: unknown) => {
					logger.debug(label, { error });
					sendResponse({ success: false, error: errorMessage(error) });
				},
			);
			return true;
		};
		if (message.type === MESSAGE_TYPES.GET_STATUS) {
			return respond(getCurrentStatus(), "Failed to get status", (status) => ({
				data: status,
				success: true,
			}));
		}

		if (message.type === MESSAGE_TYPES.SEND_PROGRESS_DATA) {
			return respond(
				handleProgressData(message.data, sender.tab?.url),
				"Progress data request failed",
				(result) => ({ result, success: true }),
			);
		}

		if (message.type === MESSAGE_TYPES.METADATA_LOOKUP) {
			return respond(handleMetadataLookup(message.data), "Metadata lookup failed", (result) => ({
				data: result,
				success: true,
			}));
		}

		if (message.type === MESSAGE_TYPES.GET_CACHED_TITLE) {
			return respond(getCurrentCachedTitle(), "Failed to get cached title", (title) => ({
				data: title,
				success: true,
			}));
		}

		return undefined;
	});
});
