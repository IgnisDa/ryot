import type { AssetLocator } from "@ryot-app/contract/modules/uploads/schemas";
import type { MediaImage } from "@ryot-app/media-plugin/query-recipes";

type MediaImages = readonly MediaImage[] | null;

const locator = (image: MediaImage | undefined): AssetLocator | undefined => {
	if (image === undefined) {
		return undefined;
	}
	return image.type === "remote"
		? { type: "remote", url: image.url }
		: { type: image.type, key: image.key };
};

export const mediaImageAssets = (images: MediaImages) =>
	(images ?? []).flatMap((image) => {
		const asset = locator(image);
		return asset === undefined ? [] : [asset];
	});

export const mediaImageAsset = (images: MediaImages, purpose: MediaImage["purpose"]) =>
	locator((images ?? []).find((image) => image.purpose === purpose));

export const preferredMediaImageAsset = (images: MediaImages, purpose: MediaImage["purpose"]) =>
	mediaImageAsset(images, purpose) ?? locator((images ?? []).at(0));
