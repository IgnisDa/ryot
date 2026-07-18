import { hmacSha256Base64Url } from "@ryot/ts-utils/crypto";

const separator = ".";
const textEncoder = new TextEncoder();

const createSignature = (secret: string, executionId: string, userId: string) =>
	hmacSha256Base64Url(secret, `${executionId}:${userId}`);

const signaturesMatch = (actual: string, expected: string) => {
	const actualBytes = textEncoder.encode(actual);
	const expectedBytes = textEncoder.encode(expected);
	const length = Math.max(actualBytes.length, expectedBytes.length);
	let mismatch = actualBytes.length ^ expectedBytes.length;

	for (let index = 0; index < length; index++) {
		mismatch |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
	}

	return mismatch === 0;
};

export const createWorkflowJobId = (secret: string, executionId: string, userId: string) =>
	`${executionId}${separator}${createSignature(secret, executionId, userId)}`;

export const resolveWorkflowExecutionId = (secret: string, userId: string, jobId: string) => {
	const separatorIndex = jobId.lastIndexOf(separator);
	if (separatorIndex <= 0 || separatorIndex === jobId.length - 1) {
		return null;
	}

	const executionId = jobId.slice(0, separatorIndex);
	const signature = jobId.slice(separatorIndex + 1);
	const expectedSignature = createSignature(secret, executionId, userId);

	return signaturesMatch(signature, expectedSignature) ? executionId : null;
};
