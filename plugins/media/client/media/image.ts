import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import { managedAssetKey } from "@ryot-app/client-sdk/react";

import type { MediaImage } from "../../shared/media-image";

export type MediaImages = readonly MediaImage[] | null;

export type MediaImageAsset = MediaImage extends infer Image
	? Image extends MediaImage
		? Omit<Image, "purpose">
		: never
	: never;

export type MediaGalleryImage = MediaImageAsset & Pick<MediaImage, "purpose">;

const locator = (image: MediaImage | undefined): MediaImageAsset | undefined => {
	if (image === undefined) {
		return undefined;
	}
	const { purpose: _purpose, ...asset } = image;
	return asset;
};

export const mediaImageAssets = (images: MediaImages) =>
	(images ?? []).flatMap((image) => {
		const asset = locator(image);
		return asset === undefined ? [] : [asset];
	});

export const mediaGalleryImages = (images: MediaImages): readonly MediaGalleryImage[] =>
	(images ?? []).flatMap((image) => {
		const asset = locator(image);
		return asset === undefined ? [] : [{ ...asset, purpose: image.purpose }];
	});

export const mediaImageAsset = (images: MediaImages, purpose: MediaImage["purpose"]) =>
	locator((images ?? []).find((image) => image.purpose === purpose));

export const preferredMediaImageAsset = (images: MediaImages, purpose: MediaImage["purpose"]) =>
	mediaImageAsset(images, purpose) ?? locator((images ?? []).at(0));

export const collectManagedAssetLocators = (assets: readonly (MediaImageAsset | undefined)[]) => {
	const managed = assets.filter(
		(asset): asset is ManagedAssetLocator => asset !== undefined && asset.type !== "remote",
	);
	return [...new Map(managed.map((asset) => [managedAssetKey(asset), asset])).values()].sort(
		(left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)),
	);
};
