import { createHmac, timingSafeEqual } from "node:crypto";

const separator = ".";

const createSignature = (secret: string, executionId: string, userId: string) =>
	createHmac("sha256", secret).update(`${executionId}:${userId}`).digest("base64url");

const signaturesMatch = (actual: string, expected: string) => {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);

	return (
		actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
	);
};

export const createSandboxJobId = (secret: string, executionId: string, userId: string) =>
	`${executionId}${separator}${createSignature(secret, executionId, userId)}`;

export const resolveSandboxExecutionId = (secret: string, userId: string, jobId: string) => {
	const separatorIndex = jobId.lastIndexOf(separator);
	if (separatorIndex <= 0 || separatorIndex === jobId.length - 1) {
		return null;
	}

	const executionId = jobId.slice(0, separatorIndex);
	const signature = jobId.slice(separatorIndex + 1);
	const expectedSignature = createSignature(secret, executionId, userId);

	return signaturesMatch(signature, expectedSignature) ? executionId : null;
};
