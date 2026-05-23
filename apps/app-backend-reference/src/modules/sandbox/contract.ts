import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { SandboxRunError, Unauthorized } from "../../lib/errors";
import { RunSandboxPayload, SandboxRunResult } from "./schemas";

const runIdParam = HttpApiSchema.param("runId", Schema.String);

export const SandboxGroup = HttpApiGroup.make("sandbox")
	.add(
		HttpApiEndpoint.post("run", "/sandbox/run")
			.setPayload(RunSandboxPayload)
			.addSuccess(SandboxRunResult, { status: 202 })
			.addError(Unauthorized, { status: 401 })
			.addError(SandboxRunError, { status: 502 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("get")`/sandbox/run/${runIdParam}`
			.addSuccess(SandboxRunResult)
			.addError(Unauthorized, { status: 401 })
			.addError(SandboxRunError, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.annotate(OpenApi.Description, "Execute sandboxed scripts and retrieve run results");
