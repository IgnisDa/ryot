import { resolveRequiredString } from "@ryot/ts-utils";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { getSandboxService } from "~/lib/sandbox";
import { sandboxRunJobResult } from "~/lib/sandbox/jobs";
import type {
	ApiFunctionDescriptor,
	SandboxEnqueueOptions,
} from "~/lib/sandbox/types";
import { getSandboxScriptForUser } from "./repository";
import type {
	EnqueueSandboxBody,
	PollSandboxResult,
	SandboxEnqueueResult,
} from "./schemas";

type SandboxMutationError = "not_found" | "validation";

type SandboxJobLookupResult = NonNullable<
	Awaited<ReturnType<typeof getSandboxJobByIdForUser>>
>;

export type SandboxServiceDeps = {
	enqueueSandboxJob: typeof enqueueSandboxJob;
	getSandboxScriptForUser: typeof getSandboxScriptForUser;
	getSandboxJobByIdForUser: typeof getSandboxJobByIdForUser;
};

export type SandboxServiceResult<T> = ServiceResult<T, SandboxMutationError>;

const sandboxJobFailedMessage = "Sandbox job failed";
const sandboxJobNotFoundError = "Sandbox job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";
const sandboxJobResultUnavailableMessage = "Sandbox job result unavailable";

const enqueueSandboxJob = async (input: SandboxEnqueueOptions) =>
	getSandboxService().enqueue(input);

const getSandboxJobByIdForUser = async (input: {
	jobId: string;
	userId: string;
}) => getSandboxService().getJobByIdForUser(input);

const sandboxServiceDeps: SandboxServiceDeps = {
	enqueueSandboxJob,
	getSandboxScriptForUser,
	getSandboxJobByIdForUser,
};

const resolveSandboxJobIdResult = (jobId: string) =>
	wrapServiceValidator(
		() => resolveSandboxJobId(jobId),
		"Sandbox job id is required",
	);

export const createApiFunctionDescriptors = (
	userId: string,
): Array<ApiFunctionDescriptor> => [
	{ context: {}, functionKey: "httpCall" },
	{ context: {}, functionKey: "getAppConfigValue" },
	{ context: { userId }, functionKey: "getEntitySchemas" },
];

export const resolveSandboxJobId = (jobId: string) =>
	resolveRequiredString(jobId, "Sandbox job id");

const createCompletedSandboxResult = (
	job: SandboxJobLookupResult["job"],
): PollSandboxResult => {
	const result = sandboxRunJobResult.safeParse(job.returnvalue);
	if (!result.success) {
		return { status: "failed", error: sandboxJobResultUnavailableMessage };
	}

	const value = result.data.value;

	return {
		status: "completed",
		logs: result.data.logs ?? null,
		error: result.data.error ?? null,
		value:
			value === undefined
				? null
				: (value as Extract<
						PollSandboxResult,
						{ status: "completed" }
					>["value"]),
	};
};

export const enqueueSandbox = async (
	input: { body: EnqueueSandboxBody; userId: string },
	deps: SandboxServiceDeps = sandboxServiceDeps,
): Promise<SandboxServiceResult<SandboxEnqueueResult>> => {
	if (input.body.kind === "script") {
		const foundSandboxScript = await deps.getSandboxScriptForUser({
			scriptId: input.body.scriptId,
			userId: input.userId,
		});
		if (!foundSandboxScript) {
			return serviceError("not_found", sandboxScriptNotFoundError);
		}

		const job = await deps.enqueueSandboxJob({
			userId: input.userId,
			context: input.body.context,
			code: foundSandboxScript.code,
			scriptId: input.body.scriptId,
			apiFunctionDescriptors: createApiFunctionDescriptors(input.userId),
		});

		return serviceData(job);
	}

	const job = await deps.enqueueSandboxJob({
		userId: input.userId,
		code: input.body.code,
		context: input.body.context,
		apiFunctionDescriptors: createApiFunctionDescriptors(input.userId),
	});

	return serviceData(job);
};

export const getSandboxResult = async (
	input: { jobId: string; userId: string },
	deps: SandboxServiceDeps = sandboxServiceDeps,
): Promise<SandboxServiceResult<PollSandboxResult>> => {
	const sandboxJobIdResult = resolveSandboxJobIdResult(input.jobId);
	if ("error" in sandboxJobIdResult) {
		return sandboxJobIdResult;
	}

	const foundJob = await deps.getSandboxJobByIdForUser({
		userId: input.userId,
		jobId: sandboxJobIdResult.data,
	});
	if (!foundJob) {
		return serviceError("not_found", sandboxJobNotFoundError);
	}

	const state = await foundJob.job.getState();
	if (state === "completed") {
		return serviceData(createCompletedSandboxResult(foundJob.job));
	}
	if (state === "failed") {
		return serviceData({
			status: "failed",
			error: foundJob.job.failedReason || sandboxJobFailedMessage,
		});
	}

	return serviceData({ status: "pending" });
};
