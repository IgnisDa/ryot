import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Effect, Redacted } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { createWorkflowJobId, resolveWorkflowExecutionId } from "#lib/shared/job-id";
import { trimToNull } from "#lib/shared/validation";
import { EntitiesRepository } from "#modules/entities/repository";
import { toEntityImportRunResult } from "#modules/entity-import/result-workflow";

import { LibraryEntityImportWorkflow } from "./library-entity-import-workflow";

const entitySchemaNotFoundError = "Entity schema not found";
const importJobNotFoundError = "Entity import job not found";

export class LibraryImportService extends Effect.Service<LibraryImportService>()(
	"LibraryImportService",
	{
		effect: Effect.gen(function* () {
			const config = yield* AppConfig;
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* EntitiesRepository;
			const jobIdSecret = Redacted.value(config.sandbox.jobIdSecret);

			const importEntity = Effect.fn("LibraryImportService.import")(function* (
				user: CurrentUserValue,
				payload: {
					externalId: string;
					providerId: SandboxProviderId;
					entitySchemaSlug: EntitySchemaSlug;
				},
			) {
				const trimmedProviderId = trimToNull(payload.providerId);
				const externalId = trimToNull(payload.externalId);
				const trimmedEntitySchemaSlug = trimToNull(payload.entitySchemaSlug);

				if (!trimmedProviderId || !externalId || !trimmedEntitySchemaSlug) {
					return yield* badRequest("providerId, externalId, and entitySchemaSlug are required");
				}

				const providerId = SandboxProviderId.make(trimmedProviderId);
				const entitySchemaSlug = EntitySchemaSlug.make(trimmedEntitySchemaSlug);

				const entitySchemaScope = yield* runWithDb(
					repository.getEntitySchemaScopeForUser({ userId: user.id, entitySchemaSlug }),
				);
				if (!entitySchemaScope) {
					return yield* notFound(entitySchemaNotFoundError);
				}

				const executionId = generateId();
				yield* engine
					.execute(LibraryEntityImportWorkflow, {
						executionId,
						discard: true,
						payload: {
							providerId,
							externalId,
							executionId,
							entitySchemaSlug,
							userId: user.id,
							origin: { kind: "api" },
						},
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
