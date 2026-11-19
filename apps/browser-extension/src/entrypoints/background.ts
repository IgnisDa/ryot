import { Cause, Effect, Option, Schema } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";

import { storage } from "#imports";

import { STORAGE_KEYS } from "../lib/constants";
import { lookupMetadata, postIntegrationWebhook } from "../lib/contract-client";
import { ExtensionStatus } from "../lib/extension-types";
import { logger } from "../lib/logger";
import { ExtensionMessage } from "../lib/messages";
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

const handleProgressData = (
	progressData: Extract<ExtensionMessage, { type: "SEND_PROGRESS_DATA" }>["data"],
	tabUrl?: string,
) =>
	Effect.gen(function* () {
		const integrationUrl = yield* fromPlatform(() =>
			storage.getItem<string>(STORAGE_KEYS.INTEGRATION_URL),
		);

		if (!integrationUrl) {
			throw new Error("Integration URL not found in storage");
		}

		const { rawData, metadata } = progressData;

		if (!tabUrl || metadata.status === "notFound") {
			return null;
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

		return null;
	}).pipe(
		Effect.tapCause((cause) =>
			Effect.sync(() => logger.error("Integration data request failed", { error: cause })),
		),
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

	browser.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
		const message = Schema.decodeUnknownOption(ExtensionMessage)(rawMessage);
		if (Option.isNone(message)) {
			return undefined;
		}
		const respond = <A, E>(program: Effect.Effect<A, E, HttpClient.HttpClient>, label: string) => {
			void Effect.runPromise(
				program.pipe(
					// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Each runtime message is a background entrypoint
					Effect.provide(FetchHttpClient.layer),
					Effect.matchCause({
						onSuccess: (data) => sendResponse({ data, success: true }),
						onFailure: (cause) => {
							const error = Cause.squash(cause);
							logger.debug(label, { error });
							sendResponse({ success: false, error: errorMessage(error) });
						},
					}),
				),
			);
		};
		switch (message.value.type) {
			case "GET_STATUS":
				respond(getCurrentStatus(), "Failed to get status");
				break;
			case "METADATA_LOOKUP":
				respond(handleMetadataLookup(message.value.data), "Metadata lookup failed");
				break;
			case "GET_CACHED_TITLE":
				respond(getCurrentCachedTitle(), "Failed to get cached title");
				break;
			case "SEND_PROGRESS_DATA":
				respond(
					handleProgressData(message.value.data, sender.tab?.url),
					"Progress data request failed",
				);
				break;
		}
		return true;
	});
});
