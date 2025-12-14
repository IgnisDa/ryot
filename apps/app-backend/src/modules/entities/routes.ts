import { HttpApiBuilder } from "@effect/platform";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { generateId } from "better-auth";
import { Effect } from "effect";

import { executeEntityCreate } from "./entity-create-workflow";
import { EntitiesService } from "./service";

export const EntitiesRoutesLive = HttpApiBuilder.group(AppContract, "entities", (handlers) =>
	handlers
		.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const engine = yield* WorkflowEngine;
				return yield* executeEntityCreate(engine, {
					body: payload,
					userId: user.id,
					origin: { kind: "api" },
					executionId: generateId(),
				}).pipe(dieOnDbError);
			}),
		)
		.handle("get", ({ path }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const service = yield* EntitiesService;
				return yield* service.getById(user, path.entityId).pipe(dieOnDbError);
			}),
		),
);
