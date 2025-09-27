export const uploadContentTypes = [
	"text/csv",
	"text/xml",
	"image/png",
	"image/gif",
	"image/avif",
	"image/jpeg",
	"image/webp",
	"application/xml",
	"application/zip",
	"application/gzip",
	"application/json",
	"application/x-gzip",
] as const;

export type UploadContentType = (typeof uploadContentTypes)[number];

export const uploadContentTypeExtensions: Record<UploadContentType, readonly string[]> = {
	"text/csv": ["csv"],
	"text/xml": ["xml"],
	"image/gif": ["gif"],
	"image/png": ["png"],
	"image/avif": ["avif"],
	"image/webp": ["webp"],
	"application/xml": ["xml"],
	"application/zip": ["zip"],
	"application/gzip": ["gz"],
	"application/x-gzip": ["gz"],
	"application/json": ["json"],
	"image/jpeg": ["jpg", "jpeg"],
};
