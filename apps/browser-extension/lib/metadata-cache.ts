import { storage } from "#imports";
import { MESSAGE_TYPES } from "./constants";
import type { CachedLookupData, MetadataLookupData } from "./extension-types";
import { extractMetadata } from "./title-extractor";

export class MetadataCache {
	private getCacheKey(url: string): `local:${string}` {
		return `local:cached-metadata:${url}`;
	}

	async getMetadataForCurrentPage(): Promise<CachedLookupData> {
		const currentUrl = window.location.href;
		const cacheKey = this.getCacheKey(currentUrl);
		const cachedData = await storage.getItem<MetadataLookupData>(cacheKey);

		return cachedData || null;
	}

	async lookupAndCacheMetadata(): Promise<CachedLookupData> {
		const metadata = extractMetadata();
		const currentUrl = window.location.href;

		try {
			const response = await browser.runtime.sendMessage({
				type: MESSAGE_TYPES.METADATA_LOOKUP,
				data: { title: metadata.title },
			});

			if (response.success && response.data) {
				const cacheKey = this.getCacheKey(currentUrl);
				await storage.setItem(cacheKey, response.data);
				console.log("[RYOT] Metadata cached for:", metadata.title);
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
