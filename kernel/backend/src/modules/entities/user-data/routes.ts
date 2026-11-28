import { CurrentUser } from "@ryot-app/contract/auth-middleware";
import { AppContract } from "@ryot-app/contract/contract";
import type { PolicyFailure } from "@ryot-app/contract/modules/changes/policies";
import {
	EntityUserDataBadRequest,
	EntityUserDataNotFound,
} from "@ryot-app/contract/modules/entity-user-data/schemas";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { apiLifecycleCommand } from "#modules/automations/lifecycle/api-command";
import type { Changes } from "#modules/changes/changes";
import type { CommitConflict } from "#modules/changes/conflict";
import type { CommitResult } from "#modules/changes/receipts";
import { ChangeSets } from "#modules/changes/service";

const stateConflict = () =>
	Effect.fail(new EntityUserDataBadRequest({ reason: { code: "state-conflict" } }));

const relationshipMergeFailed = () =>
	Effect.fail(new EntityUserDataBadRequest({ reason: { code: "relationship-merge-failed" } }));

/** The user data no longer allows the clear or merge, or one of its entities is gone. */
const userDataConflict = ({
	reason,
}: CommitConflict): Effect.Effect<never, EntityUserDataNotFound | EntityUserDataBadRequest> => {
	if (reason.code === "child-mapping-conflict") {
		return Effect.fail(new EntityUserDataBadRequest({ reason }));
	}
	return reason.code === "entity-not-found"
		? Effect.fail(new EntityUserDataNotFound({ reason }))
		: stateConflict();
};

const unexpected = <E extends { readonly _tag: string }>(
	error: E,
): error is Exclude<E, PolicyFailure | EntityUserDataNotFound | EntityUserDataBadRequest> =>
	error._tag !== "EntityUserDataBadRequest" &&
	error._tag !== "EntityUserDataNotFound" &&
	error._tag !== "PolicyRejected" &&
	error._tag !== "PolicyUnavailable";

const commitUserData = <A>(
	operation: "clear" | "merge",
	entities: NonNullable<Changes["entities"]>,
	response: (result: CommitResult) => A | undefined,
) =>
	Effect.gen(function* () {
		const user = yield* CurrentUser;
		const command = yield* apiLifecycleCommand(user, `entity-user-data:${operation}`);
		const result = yield* (yield* ChangeSets).commit({ entities, userId: user.id }, command);
		const value = response(result);
		if (value === undefined) {
			return yield* Effect.die(`An entity data ${operation} committed without its result`);
		}
		return value;
	}).pipe(
		Effect.catchTags({
			EventBadRequest: stateConflict,
			CommitConflict: userDataConflict,
			EventCreateItemError: stateConflict,
			RelationshipBadRequest: relationshipMergeFailed,
		}),
		Effect.catchIf(unexpected, Effect.die),
	);

export const EntityUserDataRoutesLive = HttpApiBuilder.group(
	AppContract,
	"entityUserData",
	(handlers) =>
		handlers
			.handle("clearEntityUserData", ({ params }) =>
				commitUserData(
					"clear",
					{ clears: [{ entitySchema: null, entityId: params.entityId }] },
					(result) => result.cleared[0],
				),
			)
			.handle("mergeEntityUserData", ({ payload }) =>
				commitUserData(
					"merge",
					{
						merges: [
							{ entitySchema: null, mergeFrom: payload.mergeFrom, mergeInto: payload.mergeInto },
						],
					},
					(result) => result.merged[0],
				),
			),
);
