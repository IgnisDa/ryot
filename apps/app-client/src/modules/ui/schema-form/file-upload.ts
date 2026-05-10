export type SchemaFileCandidate = {
	readonly name: string;
	readonly size: number;
	readonly contentType: string;
	readonly readBytes: () => Promise<Uint8Array<ArrayBuffer>>;
};

export type SchemaFilePickOutcome =
	| { readonly kind: "canceled" }
	| { readonly kind: "picked"; readonly file: SchemaFileCandidate };

export type SchemaFilePicker = (options: {
	readonly allowedFileExtensions: readonly string[];
}) => Promise<SchemaFilePickOutcome>;

export type SchemaFileUploadOutcome =
	| { readonly kind: "failed"; readonly message: string }
	| { readonly kind: "uploaded"; readonly token: string };

export type SchemaFileUpload = (request: {
	readonly fileName: string;
	readonly bytes: Uint8Array<ArrayBuffer>;
	readonly contentType: string;
}) => Promise<SchemaFileUploadOutcome>;

export const UNREADABLE_FILE_MESSAGE = "Could not read this file. Choose it again.";

const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

export const DEFAULT_UPLOAD_CONTENT_TYPE = "application/octet-stream";

const dottedExtensions = (extensions: readonly string[]) =>
	extensions.map((extension) => `.${extension.toLowerCase()}`);

export const fileAcceptAttribute = (extensions: readonly string[]) =>
	dottedExtensions(extensions).join(",");

export const allowedFileExtensionsLabel = (extensions: readonly string[]) => {
	const labels = dottedExtensions(extensions);
	const last = labels.at(-1) ?? "";
	return labels.length < 2 ? last : `${labels.slice(0, -1).join(", ")} or ${last}`;
};

export const unsupportedFileExtensionMessage = (extensions: readonly string[]) =>
	`Choose a ${allowedFileExtensionsLabel(extensions)} file.`;

export const isAllowedUploadFileName = (fileName: string, extensions: readonly string[]) => {
	const normalized = fileName.trim().toLowerCase();
	return dottedExtensions(extensions).some(
		(extension) => normalized.length > extension.length && normalized.endsWith(extension),
	);
};

export const formatFileSize = (bytes: number) => {
	let size = Math.max(0, Math.round(bytes));
	let unit = 0;
	while (size >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
		size = size / 1024;
		unit = unit + 1;
	}
	const rounded = unit === 0 ? String(size) : size.toFixed(size < 10 ? 1 : 0);
	return `${rounded} ${FILE_SIZE_UNITS[unit]}`;
};
