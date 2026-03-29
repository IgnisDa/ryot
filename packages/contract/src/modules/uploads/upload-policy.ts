export const UPLOAD_MAX_FILE_BYTES = 50 * 1024 * 1024;

export const uploadContentTypes = [
	"text/csv",
	"text/xml",
	"image/png",
	"image/gif",
	"video/mp4",
	"image/avif",
	"image/jpeg",
	"image/webp",
	"video/webm",
	"video/quicktime",
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
	"video/mp4": ["mp4"],
	"video/webm": ["webm"],
	"image/avif": ["avif"],
	"image/webp": ["webp"],
	"video/quicktime": ["mov"],
	"application/xml": ["xml"],
	"application/zip": ["zip"],
	"application/gzip": ["gz"],
	"application/x-gzip": ["gz"],
	"application/json": ["json"],
	"image/jpeg": ["jpg", "jpeg"],
};
