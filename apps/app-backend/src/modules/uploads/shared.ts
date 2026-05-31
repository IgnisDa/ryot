export const uploadContentTypes = [
	"text/csv",
	"image/png",
	"image/gif",
	"image/avif",
	"image/jpeg",
	"image/webp",
	"application/zip",
	"application/json",
] as const;

export type UploadContentType = (typeof uploadContentTypes)[number];

export const uploadContentTypeExtensions: Record<UploadContentType, readonly string[]> = {
	"text/csv": ["csv"],
	"image/gif": ["gif"],
	"image/png": ["png"],
	"image/avif": ["avif"],
	"image/webp": ["webp"],
	"application/zip": ["zip"],
	"application/json": ["json"],
	"image/jpeg": ["jpg", "jpeg"],
};
