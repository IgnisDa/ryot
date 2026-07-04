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

const mediaImageVariant = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
	Schema.Struct({ ...fields, purpose: Schema.optional(MediaImagePurposeSchema) });

export const MediaImageSchema = Schema.Union([
	mediaImageVariant(S3AssetLocator.fields),
	mediaImageVariant(LocalAssetLocator.fields),
	mediaImageVariant(RemoteAssetLocator.fields),
]);

export const MediaImageListSchema = Schema.NullOr(Schema.Array(MediaImageSchema));

export type MediaImage = Schema.Schema.Type<typeof MediaImageSchema>;
