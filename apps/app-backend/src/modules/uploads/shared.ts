export const uploadContentTypes = [
	"image/avif",
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;

export type UploadContentType = (typeof uploadContentTypes)[number];

export const uploadContentTypeExtensions: Record<UploadContentType, readonly string[]> = {
	"image/gif": ["gif"],
	"image/png": ["png"],
	"image/webp": ["webp"],
	"image/avif": ["avif"],
	"image/jpeg": ["jpg", "jpeg"],
};
