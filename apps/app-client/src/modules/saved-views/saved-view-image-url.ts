import { resolveAssetUrl } from "@/modules/ui/managed-assets";

import type { SavedViewImage } from "./display-data";

export const savedViewImageUrl = (
	image: SavedViewImage,
	managedUrls: ReadonlyMap<string, string>,
) => (image.type === "asset" ? resolveAssetUrl(image.locator, managedUrls) : undefined);
