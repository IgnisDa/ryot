import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { generateId } from "better-auth";
import { Effect, Redacted, Schema } from "effect";

import type { CurrentUserValue } from "#lib/auth";
import { AppConfig } from "#lib/config";
import { DbRunner } from "#lib/db";
import { badRequest, conflict, notFound } from "#lib/errors";
import { createWorkflowJobId, resolveWorkflowExecutionId } from "#lib/job-id";
import { slugify } from "#lib/slug";
import { trimToNull } from "#lib/validation";

import { SandboxRepository } from "./repository";
import {
	SandboxScriptMetadata,
	type CreateSandboxScriptBody,
	type EnqueueSandboxBody,
} from "./schemas";
import { RunSandboxWorkflow } from "./workflow-definitions";
import { toSandboxRunResult } from "./workflows";

const allowedHostFunctions = new Set([
	"httpCall",
	"getEntity",
	"listEvents",
	"createEvents",
	"getCachedValue",
	"getIntegration",
	"setCachedValue",
	"getEntitySchema",
	"getSystemConfig",
	"listEventSchemas",
	"listIntegrations",
	"claimCachedValue",
	"getUserPreferences",
	"executeQueryEngine",
]);
const sandboxJobNotFoundError = "Sandbox job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";

const decodeMetadata = Schema.decodeUnknown(SandboxScriptMetadata);

const resolveScriptSlug = (payload: CreateSandboxScriptBody) => {
	const name = payload.name === undefined ? null : trimToNull(payload.name);
	const candidate = payload.slug?.trim() ?? name;
	const slug = candidate ? slugify(candidate) : null;

	if (!slug) {
		return Effect.fail(badRequest("Sandbox script slug is required"));
	}
	if (!trimToNull(payload.code)) {
		return Effect.fail(badRequest("Sandbox script code is required"));
	}

	return Effect.succeed({ slug, name: name ?? slug });
};

const resolveMetadata = (metadata: unknown) =>
	decodeMetadata(metadata ?? {}).pipe(
		Effect.mapError((error) => badRequest(error.message)),
		Effect.flatMap((decoded) => {
			for (const functionKey of decoded.allowedHostFunctions ?? []) {
				if (!allowedHostFunctions.has(functionKey)) {
					return Effect.fail(badRequest(`Unknown sandbox host function: ${functionKey}`));
				}
			}
			return Effect.succeed(decoded);
		}),
	);

export class SandboxApiService extends Effect.Service<SandboxApiService>()("SandboxApiService", {
	effect: Effect.gen(function* () {
		const config = yield* AppConfig;
		const runWithDb = yield* DbRunner;
		const engine = yield* WorkflowEngine;
		const repository = yield* SandboxRepository;
		const jobIdSecret = Redacted.value(config.sandbox.jobIdSecret);

		return {
			createScript: Effect.fn("SandboxApiService.createScript")(function* (
				user: CurrentUserValue,
				payload: CreateSandboxScriptBody,
			) {
				const resolved = yield* resolveScriptSlug(payload);
				const metadata = yield* resolveMetadata(payload.metadata);

				const existing = yield* runWithDb(
					repository.findScriptBySlugForUser({ userId: user.id, slug: resolved.slug }),
				);
				if (existing) {
					return yield* conflict("A sandbox script with this slug already exists");
				}

				return yield* runWithDb(
					repository.createScript({
						metadata,
						userId: user.id,
						code: payload.code,
						slug: resolved.slug,
						name: resolved.name,
					}),
				);
			}),
			enqueue: Effect.fn("SandboxApiService.enqueue")(function* (
				user: CurrentUserValue,
				payload: EnqueueSandboxBody,
			) {
				const scriptId = trimToNull(payload.scriptId);
				const driverName = trimToNull(payload.driverName);
				if (!scriptId || !driverName) {
					return yield* notFound(sandboxScriptNotFoundError);
				}

				const script = yield* runWithDb(repository.getScriptForUser({ userId: user.id, scriptId }));
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}

				const executionId = generateId();
				yield* engine
					.execute(RunSandboxWorkflow, {
						executionId,
						discard: true,
						payload: {
							driverName,
							executionId,
							userId: user.id,
							scriptId: script.id,
							context: payload.context ?? {},
						},
					})
					.pipe(Effect.orDie);

				return { jobId: createWorkflowJobId(jobIdSecret, executionId, user.id) };
			}),
			getResult: Effect.fn("SandboxApiService.getResult")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				if (!resolvedJobId) {
					return yield* notFound(sandboxJobNotFoundError);
				}

				const executionId = resolveWorkflowExecutionId(jobIdSecret, user.id, resolvedJobId);
				if (!executionId) {
					return yield* notFound(sandboxJobNotFoundError);
				}

				return toSandboxRunResult(yield* engine.poll(RunSandboxWorkflow, executionId));
			}),
		};
	}),
}) {}
