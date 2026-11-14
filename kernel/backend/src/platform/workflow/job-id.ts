import { hmacSha256Base64Url } from "@ryot-app/ts-utils/crypto";

const separator = ".";
const keyDomain = "sandbox-job-id";
const textEncoder = new TextEncoder();

export type WorkflowJob = { readonly itemCount?: number; readonly executionId: string };

const itemCountText = (job: WorkflowJob) => job.itemCount?.toString() ?? "";

const createSignature = (secret: string, job: WorkflowJob, userId: string) =>
	hmacSha256Base64Url(secret, `${job.executionId}:${itemCountText(job)}:${userId}`);

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

export const deriveJobIdSecret = (adminAccessToken: string, domain: string = keyDomain) =>
	hmacSha256Base64Url(adminAccessToken, domain);

export const createWorkflowJobId = (secret: string, job: WorkflowJob, userId: string) =>
	`${job.executionId}${separator}${itemCountText(job)}${separator}${createSignature(secret, job, userId)}`;

export const resolveWorkflowJob = (
	secret: string,
	userId: string,
	jobId: string,
): null | WorkflowJob => {
	const signatureStart = jobId.lastIndexOf(separator);
	const countStart = jobId.lastIndexOf(separator, signatureStart - 1);
	if (countStart <= 0 || signatureStart === jobId.length - 1) {
		return null;
	}

	const executionId = jobId.slice(0, countStart);
	const countText = jobId.slice(countStart + 1, signatureStart);
	const signature = jobId.slice(signatureStart + 1);
	const itemCount = Number(countText);
	if (countText !== "" && !(/^[1-9]\d*$/.test(countText) && Number.isSafeInteger(itemCount))) {
		return null;
	}
	const job = countText === "" ? { executionId } : { itemCount, executionId };

	return signaturesMatch(signature, createSignature(secret, job, userId)) ? job : null;
};
