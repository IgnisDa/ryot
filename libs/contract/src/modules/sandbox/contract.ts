import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../auth-middleware";
import { Conflict, NotFound, RateLimited, Unauthorized } from "../../errors";
import {
	CreateSandboxScriptBody,
	EnqueueResponse,
	EnqueueSandboxBody,
	SandboxCompilationFailure,
	SandboxRunResult,
	SandboxScript,
} from "./schemas";

const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const SandboxGroup = HttpApiGroup.make("sandbox")
	.annotate(OpenApi.Description, "Manages sandbox scripts and execution jobs.")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("createScript", "/sandbox/scripts")
			.annotate(OpenApi.Description, "Creates and compiles a sandbox script.")
			.setPayload(CreateSandboxScriptBody)
			.addSuccess(SandboxScript, { status: 201 })
			.addError(SandboxCompilationFailure, { status: 400 })
			.addError(Conflict, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.post("enqueue", "/sandbox/enqueue")
			.annotate(OpenApi.Description, "Enqueues a sandbox script execution job.")
			.setPayload(EnqueueSandboxBody)
			.addSuccess(EnqueueResponse)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getResult")`/sandbox/result/${jobIdParam}`
			.annotate(OpenApi.Description, "Returns the result of a sandbox execution job.")
			.addSuccess(SandboxRunResult)
			.addError(NotFound, { status: 404 }),
	);
