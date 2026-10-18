import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import { dieOnDbError } from "@ryot-app/contract/errors";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { requireOpenSubmission } from "#modules/mutations/submission-window";

import { EntityEditorService } from "./editor/service";
import { EntityEnrichmentService } from "./providers/enrichment";
import { EntitiesService } from "./service";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				const lifecycle = {
					...rootLifecycleCommand({
						source: "api",
						lane: "interactive",
						itemIdentity: "entity",
						initiator: { id: user.id, kind: "user" },
						accountGeneration: user.accountGeneration,
						executionId: AutomationExecutionId.make(generateId()),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					}),
					writeContext: null,
				};

				return yield* service
					.createFromApi({
						lifecycle,
						scope: "user",
						userId: user.id,
						name: payload.name,
						externalId: payload.externalId,
						properties: payload.properties,
						providerId: payload.providerId,
						entitySchema: payload.entitySchema,
					})
					.pipe(dieOnDbError);
			}),
		)
		.handle("saveEditor", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const editor = yield* EntityEditorService;
				yield* requireOpenSubmission(payload.submittedAt);
				return yield* editor
					.submit({ userId: user.id, request: payload, accountGeneration: user.accountGeneration })
					.pipe(dieOnDbError);
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
