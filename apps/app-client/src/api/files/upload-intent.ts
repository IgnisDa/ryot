export const temporaryUploadIntentPayload = (request: {
	readonly fileName: string;
	readonly contentType: string;
}) => ({
	kind: "temporary" as const,
	fileName: request.fileName,
	contentType: request.contentType,
});
