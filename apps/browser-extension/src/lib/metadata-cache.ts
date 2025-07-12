import { storage } from "#imports";
import { MESSAGE_TYPES } from "./constants";
import type { MetadataLookupData } from "./extension-types";
import { extractTitle } from "./title-extractor";

export class MetadataCache {
	private getCacheKey(url: string, title: string): `local:${string}` {
		// Create a stable cache key using both URL and title
		const cleanTitle = title
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "_");
		const urlHash = btoa(url).replace(/[/+=]/g, "_");
		return `local:cached-metadata:${urlHash}:${cleanTitle}`;
	}

	async getMetadataForCurrentPage() {
		const currentUrl = window.location.href;
		const title = extractTitle();

		if (!title) {
			return null;
		}

		const cacheKey = this.getCacheKey(currentUrl, title);
		const cachedData = await storage.getItem<MetadataLookupData>(cacheKey);

		return cachedData || null;
	}

	async lookupAndCacheMetadata() {
		const title = extractTitle();
		const currentUrl = window.location.href;

		if (!title) {
			console.log("[RYOT] No title available yet, skipping metadata lookup");
			return null;
		}

		try {
			const response = await browser.runtime.sendMessage({
				data: { title },
				type: MESSAGE_TYPES.METADATA_LOOKUP,
			});

			if (response.success && response.data) {
				const cacheKey = this.getCacheKey(currentUrl, title);
				await storage.setItem(cacheKey, response.data);
				console.log("[RYOT] Metadata lookup successful for:", title);
				console.log("[RYOT] Response data:", response.data);
				console.log("[RYOT] Cached at key:", cacheKey);
				return response.data as MetadataLookupData;
			}

			console.error("[RYOT] Metadata lookup failed:", response.error);
			return null;
		} catch (error) {
			console.error("[RYOT] Failed to lookup metadata:", error);
			return null;
		}
	}
}
