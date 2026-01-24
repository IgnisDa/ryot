import { resolveRequiredString } from "@ryot/ts-utils";
import { resolveJobPollState } from "~/lib/queue/utils";
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
	{ context: { userId }, functionKey: "executeQuery" },
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
	let code = "";
	let scriptId: string | undefined;
	if (input.body.kind === "code" || input.body.kind === undefined) {
		code = input.body.code;
	} else if (input.body.kind === "script") {
		const foundSandboxScript = await deps.getSandboxScriptForUser({
			userId: input.userId,
			scriptId: input.body.scriptId,
		});
		if (!foundSandboxScript) {
			return serviceError("not_found", sandboxScriptNotFoundError);
		}
		code = foundSandboxScript.code;
		scriptId = input.body.scriptId;
	}

	const job = await deps.enqueueSandboxJob({
		code,
		scriptId,
		userId: input.userId,
		context: input.body.context,
		driverName: input.body.driverName,
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

	return serviceData(
		await resolveJobPollState(foundJob.job, sandboxJobFailedMessage, () =>
			createCompletedSandboxResult(foundJob.job),
		),
	);
};
