import type { ManagedAssetLocator } from "@ryot-app/client-sdk";
import { managedAssetKey } from "@ryot-app/client-sdk/react";

import type { MediaImage } from "../../shared/media-image";

type MediaImages = readonly MediaImage[] | null;

export type ShowImageAsset = MediaImage extends infer Image
	? Image extends MediaImage
		? Omit<Image, "purpose">
		: never
	: never;

const locator = (image: MediaImage | undefined): ShowImageAsset | undefined => {
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

export const mediaImageAsset = (images: MediaImages, purpose: MediaImage["purpose"]) =>
	locator((images ?? []).find((image) => image.purpose === purpose));

export const preferredMediaImageAsset = (images: MediaImages, purpose: MediaImage["purpose"]) =>
	mediaImageAsset(images, purpose) ?? locator((images ?? []).at(0));

export const collectManagedAssetLocators = (assets: readonly (ShowImageAsset | undefined)[]) => {
	const managed = assets.filter(
		(asset): asset is ManagedAssetLocator => asset !== undefined && asset.type !== "remote",
	);
	return [...new Map(managed.map((asset) => [managedAssetKey(asset), asset])).values()].sort(
		(left, right) => managedAssetKey(left).localeCompare(managedAssetKey(right)),
	);
};
