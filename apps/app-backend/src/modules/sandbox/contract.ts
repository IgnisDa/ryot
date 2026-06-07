import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "#lib/auth-middleware";
import { BadRequest, Conflict, NotFound, RateLimited, Unauthorized } from "#lib/errors";

import {
	CreateSandboxScriptBody,
	EnqueueResponse,
	EnqueueSandboxBody,
	SandboxRunResult,
	SandboxScript,
} from "./schemas";

const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const SandboxGroup = HttpApiGroup.make("sandbox")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.middleware(AuthMiddleware)
	.add(
		HttpApiEndpoint.post("createScript", "/sandbox/scripts")
			.setPayload(CreateSandboxScriptBody)
			.addSuccess(SandboxScript, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.addError(Conflict, { status: 409 }),
	)
	.add(
		HttpApiEndpoint.post("enqueue", "/sandbox/enqueue")
			.setPayload(EnqueueSandboxBody)
			.addSuccess(EnqueueResponse)
			.addError(NotFound, { status: 404 }),
	)
	.add(
		HttpApiEndpoint.get("getResult")`/sandbox/result/${jobIdParam}`
			.addSuccess(SandboxRunResult)
			.addError(NotFound, { status: 404 }),
	);
