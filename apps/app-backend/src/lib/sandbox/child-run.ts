import { type Job, WaitingChildrenError } from "bullmq";

import { getQueues } from "~/lib/queue";

import { sandboxRunJobName, sandboxRunJobResult } from "./jobs";

type SandboxChildJobInput = {
	childJobId: string;
	sandboxJobData: Record<string, unknown>;
};

const findSandboxChildValue = (
	childrenValues: Record<string, unknown>,
	sandboxChildJobId: string | undefined,
) => {
	const childEntries = Object.entries(childrenValues);
	if (sandboxChildJobId) {
		const matchingChildren = childEntries.filter(
			([key]) => key === sandboxChildJobId || key.endsWith(`:${sandboxChildJobId}`),
		);
		if (matchingChildren.length === 1) {
			return matchingChildren[0]?.[1];
		}
	}

	if (childEntries.length === 1) {
		return childEntries[0]?.[1];
	}

	return undefined;
};

const findExactSandboxChildValue = (
	childrenValues: Record<string, unknown>,
	sandboxChildJobId: string,
) => {
	const matchingChildren = Object.entries(childrenValues).filter(
		([key]) => key === sandboxChildJobId || key.endsWith(`:${sandboxChildJobId}`),
	);
	if (matchingChildren.length === 1) {
		return matchingChildren[0]?.[1];
	}

	return undefined;
};

export const queueSandboxChildRun = async (input: {
	job: Job;
	childJobId: string;
	jobData: Record<string, unknown>;
	sandboxJobData: Record<string, unknown>;
}) => {
	if (!input.job.id) {
		throw new Error("Parent job id is missing");
	}
	const parentJobId = input.job.id;

	await getQueues().sandboxQueue.add(sandboxRunJobName, input.sandboxJobData, {
		jobId: input.childJobId,
		parent: { id: parentJobId, queue: input.job.queueQualifiedName },
	});
	await input.job.updateData(input.jobData);
};

export const queueSandboxChildJobsBatch = async (input: {
	job: Job;
	jobData: Record<string, unknown>;
	children: SandboxChildJobInput[];
}) => {
	if (!input.job.id) {
		throw new Error("Parent job id is missing");
	}
	const parentJobId = input.job.id;

	await Promise.all(
		input.children.map((child) =>
			getQueues().sandboxQueue.add(sandboxRunJobName, child.sandboxJobData, {
				jobId: child.childJobId,
				parent: { id: parentJobId, queue: input.job.queueQualifiedName },
			}),
		),
	);
	await input.job.updateData(input.jobData);
};

export const waitForSandboxChildRun = async (job: Job, token: string | undefined) => {
	if (!token) {
		throw new Error("Parent job token is missing");
	}

	const shouldWait = await job.moveToWaitingChildren(token);
	if (shouldWait) {
		throw new WaitingChildrenError();
	}
};

export const getSandboxChildRunResult = async (job: Job, sandboxChildJobId?: string) => {
	const childrenValues = await job.getChildrenValues();
	const childValue = findSandboxChildValue(childrenValues, sandboxChildJobId);
	if (childValue === undefined) {
		throw new Error("Sandbox child job did not complete successfully");
	}

	const parsed = sandboxRunJobResult.safeParse(childValue);
	if (!parsed.success) {
		throw new Error("Sandbox child job returned an invalid payload");
	}

	return parsed.data;
};

export const getSandboxChildRunResults = async (input: {
	job: Job;
	sandboxChildJobIds: string[];
}) => {
	const childrenValues = await input.job.getChildrenValues();
	return Object.fromEntries(
		input.sandboxChildJobIds.map((sandboxChildJobId) => {
			const childValue = findExactSandboxChildValue(childrenValues, sandboxChildJobId);
			if (childValue === undefined) {
				throw new Error(`Sandbox child job '${sandboxChildJobId}' did not complete successfully`);
			}

			const parsed = sandboxRunJobResult.safeParse(childValue);
			if (!parsed.success) {
				throw new Error(`Sandbox child job '${sandboxChildJobId}' returned an invalid payload`);
			}

			return [sandboxChildJobId, parsed.data];
		}),
	);
};
