import { Schema } from "@ryot-app/plugin-kit/effect";
import { LocalAssetLocator, RemoteAssetLocator, S3AssetLocator } from "@ryot-app/plugin-kit/schema";

export const mediaImagePurposes = [
	"cover",
	"backdrop",
	"profile",
	"logo",
	"still",
	"screenshot",
	"artwork",
] as const;

const MediaImagePurposeSchema = Schema.Literals(mediaImagePurposes);
const remoteImageFields = {
	sourceId: Schema.optionalKey(Schema.String),
	largeUrl: Schema.optionalKey(Schema.String),
	language: Schema.optionalKey(Schema.String),
	thumbnailUrl: Schema.optionalKey(Schema.String),
};

const mediaImageVariant = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct({ ...fields, purpose: MediaImagePurposeSchema });

export const MediaImageSchema = Schema.Union([
	mediaImageVariant(S3AssetLocator.fields),
	mediaImageVariant(LocalAssetLocator.fields),
	mediaImageVariant({ ...RemoteAssetLocator.fields, ...remoteImageFields }),
]);

export const MediaImageAssetSchema = Schema.Union([
	S3AssetLocator,
	LocalAssetLocator,
	Schema.Struct({ ...RemoteAssetLocator.fields, ...remoteImageFields }),
]);

export const MediaImageListSchema = Schema.NullOr(Schema.Array(MediaImageSchema));

export type MediaImage = Schema.Schema.Type<typeof MediaImageSchema>;
export type MediaImageAsset = Schema.Schema.Type<typeof MediaImageAssetSchema>;

const providerImageBudget = {
	logo: 2,
	cover: 3,
	still: 2,
	profile: 4,
	artwork: 4,
	backdrop: 3,
	screenshot: 4,
} satisfies Record<MediaImage["purpose"], number>;

export const curateProviderImages = <Image extends MediaImage>(images: readonly Image[]) => {
	const seen = new Set<string>();
	const counts = new Map<MediaImage["purpose"], number>();
	return images.filter((image) => {
		if (image.type !== "remote") {
			return true;
		}
		const count = counts.get(image.purpose) ?? 0;
		const key = image.sourceId ?? image.url;
		if (seen.has(key) || count >= providerImageBudget[image.purpose]) {
			return false;
		}
		seen.add(key);
		counts.set(image.purpose, count + 1);
		return true;
	});
};
