import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { DbError, dieOnDbError } from "@ryot-app/contract/errors";
import {
	EntityBadRequest,
	EntityNotFound,
	EntityStale,
} from "@ryot-app/contract/modules/entities/schemas";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { rejectKernelOwnedSchemas } from "#modules/changes/authority";
import { savedEntity } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";
import { requireOpenSubmission } from "#modules/mutations/submission-window";

import { EntityEditorService } from "./editor/service";
import { EntityPopulation } from "./populate";
import { EntityEnrichmentService } from "./providers/enrichment";

const isRouteFailure = Schema.is(
	Schema.Union([DbError, EntityBadRequest, EntityNotFound, EntityStale]),
);

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				if (payload.providerId !== undefined) {
					return yield* new EntityBadRequest({ reason: { code: "provider-owned" } });
				}
				const changes = {
					userId: user.id,
					entity: {
						name: payload.name,
						properties: payload.properties,
						entitySchema: payload.entitySchema,
						target: { kind: "create" as const },
					},
				};
				yield* rejectKernelOwnedSchemas(changes);
				if (payload.externalId !== undefined) {
					return yield* new EntityBadRequest({
						reason: { code: "incomplete-provenance", fields: ["externalId", "providerId"] },
					});
				}
				const command = {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						itemIdentity: "entity",
						accountUserId: user.id,
						initiator: { id: user.id, kind: "user" },
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					}),
					writeContext: null,
				};
				const result = yield* (yield* ChangeSets).commit(changes, command);
				return { entity: yield* savedEntity(result) };
			}).pipe(
				Effect.catchTag("AutomationPolicyExecutionError", (error) =>
					Effect.fail(
						new EntityBadRequest({
							reason: { runId: error.runId, code: "policy-execution-failed" },
						}),
					),
				),
				Effect.catchIf((error) => !isRouteFailure(error), Effect.die),
				dieOnDbError,
			),
		)
		.handle("saveEditor", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const editor = yield* EntityEditorService;
				yield* requireOpenSubmission(payload.submittedAt);
				return yield* editor
					.submit({ userId: user.id, request: payload, accountUserId: user.id })
					.pipe(dieOnDbError);
			}),
		)
		.handle("populate", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const population = yield* EntityPopulation;
				yield* population
					.request(
						{
							userId: user.id,
							accountUserId: user.id,
							preferredLanguage: user.preferences.contentLanguage,
						},
						payload,
					)
					.pipe(Effect.orDie);
			}),
		)
		.handle("requestEnrichment", ({ params, payload }) =>
			Effect.gen(function* () {
				const enrichment = yield* EntityEnrichmentService;
				return yield* enrichment
					.request({ ...payload, user: yield* CurrentUser, entityId: params.entityId })
					.pipe(dieOnDbError);
			}),
		),
);
