import { resolveRequiredSlug, resolveRequiredString } from "@ryot/ts-utils";
import { isUniqueConstraintError } from "~/lib/app/postgres";
import { resolveJobPollState } from "~/lib/queue/utils";
import {
	type ServiceResult,
	serviceData,
	serviceError,
	wrapServiceValidator,
} from "~/lib/result";
import { getSandboxService } from "~/lib/sandbox";
import { sandboxRunJobResult } from "~/lib/sandbox/jobs";
import type { SandboxEnqueueOptions } from "~/lib/sandbox/types";
import {
	createSandboxScriptForUser,
	getSandboxScriptBySlugForUser,
	getSandboxScriptForUser,
} from "./repository";
import type {
	CreateSandboxScriptBody,
	EnqueueSandboxBody,
	PollSandboxResult,
	SandboxEnqueueResult,
	SandboxScript,
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

export type SandboxScriptServiceDeps = {
	createSandboxScriptForUser: typeof createSandboxScriptForUser;
	getSandboxScriptBySlugForUser: typeof getSandboxScriptBySlugForUser;
};

export type SandboxServiceResult<T> = ServiceResult<T, SandboxMutationError>;

const sandboxJobFailedMessage = "Sandbox job failed";
const sandboxJobNotFoundError = "Sandbox job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";
const sandboxScriptUniqueConstraint = "sandbox_script_user_slug_unique";
const sandboxJobResultUnavailableMessage = "Sandbox job result unavailable";
const sandboxScriptSlugExistsError =
	"A sandbox script with this slug already exists";

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

const sandboxScriptServiceDeps: SandboxScriptServiceDeps = {
	createSandboxScriptForUser,
	getSandboxScriptBySlugForUser,
};

const resolveSandboxJobIdResult = (jobId: string) =>
	wrapServiceValidator(
		() => resolveSandboxJobId(jobId),
		"Sandbox job id is required",
	);

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

export const createSandboxScript = async (
	input: { body: CreateSandboxScriptBody; userId: string },
	deps: SandboxScriptServiceDeps = sandboxScriptServiceDeps,
): Promise<SandboxServiceResult<SandboxScript>> => {
	const slugResult = wrapServiceValidator(
		() =>
			resolveRequiredSlug({
				name: input.body.name,
				slug: input.body.slug,
				label: "Sandbox script",
			}),
		"Sandbox script slug is required",
	);
	if ("error" in slugResult) {
		return slugResult;
	}

	const existingScript = await deps.getSandboxScriptBySlugForUser({
		slug: slugResult.data,
		userId: input.userId,
	});
	if (existingScript) {
		return serviceError("validation", sandboxScriptSlugExistsError);
	}

	try {
		const created = await deps.createSandboxScriptForUser({
			userId: input.userId,
			name: input.body.name,
			slug: slugResult.data,
			code: input.body.code,
		});
		return serviceData(created);
	} catch (error) {
		if (isUniqueConstraintError(error, sandboxScriptUniqueConstraint)) {
			return serviceError("validation", sandboxScriptSlugExistsError);
		}
		throw error;
	}
};

export const enqueueSandbox = async (
	input: { body: EnqueueSandboxBody; userId: string },
	deps: SandboxServiceDeps = sandboxServiceDeps,
): Promise<SandboxServiceResult<SandboxEnqueueResult>> => {
	const foundSandboxScript = await deps.getSandboxScriptForUser({
		userId: input.userId,
		scriptId: input.body.scriptId,
	});
	if (!foundSandboxScript) {
		return serviceError("not_found", sandboxScriptNotFoundError);
	}

	const job = await deps.enqueueSandboxJob({
		userId: input.userId,
		context: input.body.context,
		scriptId: input.body.scriptId,
		driverName: input.body.driverName,
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
