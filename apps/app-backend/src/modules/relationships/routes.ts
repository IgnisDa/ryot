import { HttpApiBuilder } from "@effect/platform";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import { generateId } from "better-auth";
import { Effect } from "effect";

import { executeRelationshipCreate } from "./relationship-create-workflow";

export const RelationshipsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"relationships",
	(handlers) =>
		handlers.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const engine = yield* WorkflowEngine;
				return yield* executeRelationshipCreate(engine, {
					body: payload,
					userId: user.id,
					origin: { kind: "api" },
					executionId: generateId(),
				}).pipe(dieOnDbError);
			}),
		),
);
