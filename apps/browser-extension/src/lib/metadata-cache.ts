import { storage } from "#imports";
import { MESSAGE_TYPES, STORAGE_KEYS } from "./constants";
import type { MetadataLookupData } from "./extension-types";
import { logger } from "./logger";
import { extractMetadataTitle } from "./metadata-extractor";

export class MetadataCache {
	private getCacheKey(title: string): `local:${string}` {
		const cleanTitle = title
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "_");
		return `local:cached-metadata:${cleanTitle}`;
	}

	async setCurrentPageTitle(title: string) {
		await storage.setItem(STORAGE_KEYS.CURRENT_PAGE_TITLE, title);
	}

	async getCurrentPageTitle(): Promise<string | null> {
		return await storage.getItem<string>(STORAGE_KEYS.CURRENT_PAGE_TITLE);
	}

	async getMetadataForCurrentPage() {
		const title = extractMetadataTitle();

		if (!title) return null;

		await this.setCurrentPageTitle(title);

		const cacheKey = this.getCacheKey(title);
		const cachedData = await storage.getItem<MetadataLookupData>(cacheKey);

		return cachedData || null;
	}

	async lookupAndCacheMetadata() {
		const title = extractMetadataTitle();

		if (!title) {
			logger.debug("No title available yet, skipping metadata lookup");
			return null;
		}

		await this.setCurrentPageTitle(title);

		try {
			const response = await browser.runtime.sendMessage({
				data: { title },
				type: MESSAGE_TYPES.METADATA_LOOKUP,
			});

			if (response.success && response.data) {
				const cacheKey = this.getCacheKey(title);
				await storage.setItem(cacheKey, response.data.response);
				logger.debug("Metadata lookup successful", {
					title,
					cacheKey,
					responseData: response.data,
				});
				return response.data.response as MetadataLookupData;
			}

			logger.debug("Metadata lookup failed", { error: response.error });
			return null;
		} catch (error) {
			logger.error("Failed to lookup metadata", { error });
			return null;
		}
	}
}
