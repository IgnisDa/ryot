import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import { EntitySchemaId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Effect, Redacted } from "effect";

import { AppConfig } from "#lib/config/service";
import { DbRunner } from "#lib/db/service";
import { createWorkflowJobId, resolveWorkflowExecutionId } from "#lib/job-id";
import { trimToNull } from "#lib/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { toEntityImportRunResult } from "#modules/entity-import/result-workflow";
import { SandboxRepository } from "#modules/sandbox/repository";

import { LibraryEntityImportWorkflow } from "./library-entity-import-workflow";

const entitySchemaNotFoundError = "Entity schema not found";
const importJobNotFoundError = "Entity import job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";

export class LibraryImportService extends Effect.Service<LibraryImportService>()(
	"LibraryImportService",
	{
		effect: Effect.gen(function* () {
			const config = yield* AppConfig;
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* EntitiesRepository;
			const sandboxRepository = yield* SandboxRepository;
			const jobIdSecret = Redacted.value(config.sandbox.jobIdSecret);

			const importEntity = Effect.fn("LibraryImportService.import")(function* (
				user: CurrentUserValue,
				payload: {
					externalId: string;
					scriptId: SandboxScriptId;
					entitySchemaId: EntitySchemaId;
				},
			) {
				const trimmedScriptId = trimToNull(payload.scriptId);
				const externalId = trimToNull(payload.externalId);
				const trimmedEntitySchemaId = trimToNull(payload.entitySchemaId);

				if (!trimmedScriptId || !externalId || !trimmedEntitySchemaId) {
					return yield* badRequest("scriptId, externalId, and entitySchemaId are required");
				}

				const entitySchemaId = EntitySchemaId.make(trimmedEntitySchemaId);
				const scriptId = SandboxScriptId.make(trimmedScriptId);
				const script = yield* runWithDb(
					sandboxRepository.getScriptForUser({ userId: user.id, scriptId }),
				);
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}

				const entitySchemaScope = yield* runWithDb(
					repository.getEntitySchemaScopeForUser({ userId: user.id, entitySchemaId }),
				);
				if (!entitySchemaScope) {
					return yield* notFound(entitySchemaNotFoundError);
				}

				const executionId = generateId();
				yield* engine
					.execute(LibraryEntityImportWorkflow, {
						executionId,
						discard: true,
						payload: { scriptId, externalId, executionId, entitySchemaId, userId: user.id },
					})
					.pipe(Effect.orDie);

				return { jobId: createWorkflowJobId(jobIdSecret, executionId, user.id) };
			});

			const getImportResult = Effect.fn("LibraryImportService.getImportResult")(function* (
				user: CurrentUserValue,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				if (!resolvedJobId) {
					return yield* notFound(importJobNotFoundError);
				}

				const executionId = resolveWorkflowExecutionId(jobIdSecret, user.id, resolvedJobId);
				if (!executionId) {
					return yield* notFound(importJobNotFoundError);
				}

				return toEntityImportRunResult(
					yield* engine.poll(LibraryEntityImportWorkflow, executionId),
				);
			});

			return { getImportResult, import: importEntity };
		}),
	},
) {}
