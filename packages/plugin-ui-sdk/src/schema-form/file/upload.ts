import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

export type SchemaFilePicker = (options: {
	readonly allowedFileExtensions: readonly string[];
}) => Promise<SchemaFilePickOutcome>;

export type SchemaFilePickOutcome =
	{ readonly kind: "canceled" } | { readonly kind: "picked"; readonly file: SchemaFileCandidate };

export type SchemaFileCandidate = {
	readonly name: string;
	readonly size: number;
	readonly source: Blob;
	readonly contentType: string;
};

export type SchemaFileUploadOutcome =
	| { readonly message: Text; readonly kind: "failed" }
	| { readonly token: string; readonly kind: "uploaded" };

export type SchemaFileUpload = (request: {
	readonly source: Blob;
	readonly fileName: string;
	readonly contentType: string;
}) => Promise<SchemaFileUploadOutcome>;

const FILE_SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
const ZIP_CONTENT_TYPE = "application/zip";
const GENERIC_CONTENT_TYPES = new Set([
	"",
	"binary/octet-stream",
	"application/x-download",
	"application/octet-stream",
]);
const ZIP_CONTENT_TYPES = new Set([
	ZIP_CONTENT_TYPE,
	"multipart/x-zip",
	"application/x-zip",
	"application/x-compressed",
	"application/x-zip-compressed",
]);

export const DEFAULT_UPLOAD_CONTENT_TYPE = "application/octet-stream";

const dottedExtensions = (extensions: readonly string[]) =>
	extensions.map((extension) => `.${extension.toLowerCase()}`);

export const fileAcceptAttribute = (extensions: readonly string[]) =>
	dottedExtensions(extensions).join(",");

export const allowedFileExtensionsLabel = (formatters: Formatters, extensions: readonly string[]) =>
	formatters.list({ type: "disjunction" }).format(dottedExtensions(extensions));

export const unsupportedFileExtensionMessage = (
	formatters: Formatters,
	extensions: readonly string[],
) =>
	kernelMessage("ui.file-field.unsupported-extension", {
		extensions: allowedFileExtensionsLabel(formatters, extensions),
	});

export const isAllowedUploadFileName = (fileName: string, extensions: readonly string[]) => {
	const normalized = fileName.trim().toLowerCase();
	return dottedExtensions(extensions).some(
		(extension) => normalized.length > extension.length && normalized.endsWith(extension),
	);
};

export const normalizeUploadContentType = (fileName: string, contentType: string) => {
	const normalized = contentType.trim().toLowerCase().split(";", 1)[0] ?? "";
	const isZipFile = isAllowedUploadFileName(fileName, ["zip"]);
	if (isZipFile) {
		return ZIP_CONTENT_TYPES.has(normalized) || GENERIC_CONTENT_TYPES.has(normalized)
			? ZIP_CONTENT_TYPE
			: undefined;
	}
	if (ZIP_CONTENT_TYPES.has(normalized)) {
		return undefined;
	}
	return normalized === "" ? DEFAULT_UPLOAD_CONTENT_TYPE : normalized;
};

export const formatFileSize = (formatters: Formatters, bytes: number) => {
	let size = Math.max(0, Math.round(bytes));
	let unit = 0;
	while (size >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
		size = size / 1024;
		unit = unit + 1;
	}
	const fractionDigits = unit > 0 && size < 10 ? 1 : 0;
	return formatters
		.number({
			style: "unit",
			unit: FILE_SIZE_UNITS[unit],
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
			// CLDR's short byte is often a word ("byte", "Byte"); its narrow form is the symbol.
			unitDisplay: unit === 0 ? "narrow" : "short",
		})
		.format(size);
};
