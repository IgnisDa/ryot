import { storage } from "#imports";
import { MESSAGE_TYPES } from "./constants";
import type { MetadataLookupData } from "./extension-types";
import { extractTitle } from "./title-extractor";

export class MetadataCache {
	private getCacheKey(url: string): `local:${string}` {
		return `local:cached-metadata:${url}`;
	}

	async getMetadataForCurrentPage() {
		const currentUrl = window.location.href;
		const cacheKey = this.getCacheKey(currentUrl);
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
				const cacheKey = this.getCacheKey(currentUrl);
				await storage.setItem(cacheKey, response.data);
				console.log("[RYOT] Metadata cached for:", title);
				return response.data;
			}

			console.error("[RYOT] Metadata lookup failed:", response.error);
			return null;
		} catch (error) {
			console.error("[RYOT] Failed to lookup metadata:", error);
			return null;
		}
	}
}
