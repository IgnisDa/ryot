import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, Unauthorized } from "../../lib/errors";

const SandboxScript = Schema.Struct({
	id: Schema.String,
	slug: Schema.String,
	code: Schema.String,
	name: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
});

const CreateSandboxScriptBody = Schema.Struct({
	code: Schema.String,
	name: Schema.optional(Schema.String),
	slug: Schema.optional(Schema.String),
	metadata: Schema.optional(Schema.Unknown),
});

const EnqueueSandboxBody = Schema.Struct({
	scriptId: Schema.String,
	driverName: Schema.String,
	context: Schema.optional(Schema.Unknown),
});

const EnqueueResponse = Schema.Struct({ jobId: Schema.String });

export const SandboxRunResult = Schema.Union(
	Schema.Struct({ status: Schema.Literal("pending") }),
	Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }),
	Schema.Struct({
		value: Schema.Unknown,
		status: Schema.Literal("completed"),
		logs: Schema.optional(Schema.Array(Schema.String)),
		error: Schema.optional(Schema.String),
		timing: Schema.optional(Schema.Unknown),
	}),
);

const jobIdParam = HttpApiSchema.param("jobId", Schema.String);

export const SandboxGroup = HttpApiGroup.make("sandbox")
	.add(
		HttpApiEndpoint.post("createScript", "/sandbox/scripts")
			.setPayload(CreateSandboxScriptBody)
			.addSuccess(SandboxScript, { status: 201 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.post("enqueue", "/sandbox/enqueue")
			.setPayload(EnqueueSandboxBody)
			.addSuccess(EnqueueResponse)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("getResult")`/sandbox/result/${jobIdParam}`
			.addSuccess(SandboxRunResult)
			.addError(NotFound, { status: 404 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
