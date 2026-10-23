import type { MetadataLookupResult } from "@ryot-app/media-plugin/contracts/operations";
import { Effect } from "effect";

import { storage } from "#imports";

import { MESSAGE_TYPES, STORAGE_KEYS } from "./constants";
import { logger } from "./logger";
import { extractMetadataTitle } from "./metadata-extractor";
import { fromPlatform } from "./platform";

export class MetadataCache {
	private getCacheKey(title: string): `local:${string}` {
		const cleanTitle = title
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "_");
		return `local:cached-metadata:${cleanTitle}`;
	}

	getMetadataForCurrentPage() {
		const title = extractMetadataTitle();
		const cacheKey = title ? this.getCacheKey(title) : null;
		return Effect.gen(function* () {
			if (!title || !cacheKey) {
				return null;
			}

			yield* fromPlatform(() => storage.setItem(STORAGE_KEYS.CURRENT_PAGE_TITLE, title));

			const cachedData = yield* fromPlatform(() => storage.getItem<MetadataLookupResult>(cacheKey));

			return cachedData ?? null;
		});
	}

	lookupAndCacheMetadata() {
		const title = extractMetadataTitle();
		const cacheKey = title ? this.getCacheKey(title) : null;
		return Effect.gen(function* () {
			if (!title || !cacheKey) {
				logger.debug("No title available yet, skipping metadata lookup");
				return null;
			}

			yield* fromPlatform(() => storage.setItem(STORAGE_KEYS.CURRENT_PAGE_TITLE, title));

			return yield* Effect.gen(function* () {
				const response = yield* fromPlatform(() =>
					browser.runtime.sendMessage({ data: { title }, type: MESSAGE_TYPES.METADATA_LOOKUP }),
				);

				if (response.success && response.data) {
					yield* fromPlatform(() => storage.setItem(cacheKey, response.data));
					logger.debug("Metadata lookup successful", {
						title,
						cacheKey,
						responseData: response.data,
					});
					return response.data;
				}

				logger.debug("Metadata lookup failed", { error: response.error });
				return null;
			}).pipe(
				Effect.catch((error) => {
					logger.error("Failed to lookup metadata", { error });
					return Effect.succeed(null);
				}),
			);
		});
	}
}
