import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { hmacSha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { Schema } from "effect";

const separator = ".";
const keyDomain = "sandbox-job-id";
const textEncoder = new TextEncoder();

export type WorkflowJob = { readonly lane: ExecutionLane; readonly executionId: string };

const isExecutionLane = Schema.is(ExecutionLane);

const createSignature = (secret: string, job: WorkflowJob, userId: string) =>
	hmacSha256Base64Url(secret, `${job.lane}:${job.executionId}:${userId}`);

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
	`${job.lane}${separator}${job.executionId}${separator}${createSignature(secret, job, userId)}`;

export const resolveWorkflowJob = (
	secret: string,
	userId: string,
	jobId: string,
): WorkflowJob | null => {
	const laneEnd = jobId.indexOf(separator);
	const signatureStart = jobId.lastIndexOf(separator);
	if (laneEnd <= 0 || signatureStart <= laneEnd + 1 || signatureStart === jobId.length - 1) {
		return null;
	}

	const lane = jobId.slice(0, laneEnd);
	if (!isExecutionLane(lane)) {
		return null;
	}
	const job = { lane, executionId: jobId.slice(laneEnd + 1, signatureStart) };
	const signature = jobId.slice(signatureStart + 1);

	return signaturesMatch(signature, createSignature(secret, job, userId)) ? job : null;
};
