import type { JsonValue } from "@ryot/contract/modules/sandbox/wire";

import type { ProviderSearchItem } from "./search-controller";

type ProviderSearchItemDisplay = {
	readonly title: string;
	readonly metaText: string | undefined;
	readonly imageUrl: string | undefined;
};

const META_SEPARATOR = " \u00b7 ";

const isRecord = (value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: JsonValue | undefined) => (isRecord(value) ? value : undefined);

const readRemoteImageUrl = (property: JsonValue | undefined) => {
	const image = asRecord(property);
	if (image?.kind !== "image") {
		return undefined;
	}
	const locator = asRecord(image.value);
	if (locator?.type !== "remote" || typeof locator.url !== "string") {
		return undefined;
	}
	return locator.url;
};

const renderMetaPart = (property: JsonValue | undefined) => {
	const part = asRecord(property);
	if (part?.kind === "number" && typeof part.value === "number") {
		return String(part.value);
	}
	if (part?.kind === "text" && typeof part.value === "string") {
		const trimmed = part.value.trim();
		return trimmed === "" ? undefined : trimmed;
	}
	return undefined;
};

export const describeProviderSearchItem = (item: ProviderSearchItem): ProviderSearchItemDisplay => {
	const parts = [
		renderMetaPart(item.secondarySubtitleProperty),
		renderMetaPart(item.primarySubtitleProperty),
		renderMetaPart(item.calloutProperty),
	].filter((part) => part !== undefined);
	return {
		title: item.titleProperty.value,
		imageUrl: readRemoteImageUrl(item.imageProperty),
		metaText: parts.length === 0 ? undefined : parts.join(META_SEPARATOR),
	};
};
