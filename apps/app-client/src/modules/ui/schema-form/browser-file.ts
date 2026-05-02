import { DEFAULT_UPLOAD_CONTENT_TYPE, type SchemaFileCandidate } from "./file-upload";

export const browserFileCandidate = (file: File): SchemaFileCandidate => ({
	name: file.name,
	size: file.size,
	contentType: file.type === "" ? DEFAULT_UPLOAD_CONTENT_TYPE : file.type,
	readBytes: async () => new Uint8Array(await file.arrayBuffer()),
});
