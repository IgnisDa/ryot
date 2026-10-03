import type { ContractSuccess } from "@ryot-app/contract/client";
import type { UserLifecycleOperation } from "@ryot-app/contract/modules/god-mode/user-lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import { userLifecycleOperationRecipe } from "@ryot-app/ryotql-recipes/god-mode";
import { Effect, Option } from "effect";

import { assertCompleted } from "~/support/assertions";

import { adminHeaders } from "./admin";
import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";
import { executeAdminRyotQLRecipe } from "./ryotql";

export type DeleteUserOperation = ContractSuccess<"godMode", "deleteUser">;

const requestUserDeletion = (userId: string) =>
	getApiClient().call(
		(c) => c.godMode.deleteUser({ params: { userId: UserId.make(userId) } }),
		adminHeaders(),
	);

export const requestUserReset = (userId: string) =>
	getApiClient().call(
		(c) => c.godMode.resetUser({ params: { userId: UserId.make(userId) } }),
		adminHeaders(),
	);

export const pollUserLifecycleOperation = (operationId: UserLifecycleOperation["id"]) =>
	pollUntil(
		`User lifecycle operation '${operationId}' to complete`,
		executeAdminRyotQLRecipe(userLifecycleOperationRecipe({ id: operationId })).pipe(
			Effect.map((detail) => {
				const operation = Option.getOrNull(detail);
				return operation?.status === "completed" || operation?.status === "failed"
					? operation
					: null;
			}),
		),
	);

export const deleteUserAndWait = (userId: string) =>
	requestUserDeletion(userId).pipe(
		Effect.flatMap(({ operationId }) => pollUserLifecycleOperation(operationId)),
		Effect.map((operation) => {
			assertCompleted(operation, `User lifecycle operation '${operation.id}'`);
			return operation;
		}),
	);

export const resetUserAndWait = (userId: string) =>
	requestUserReset(userId).pipe(
		Effect.flatMap(({ operationId }) => pollUserLifecycleOperation(operationId)),
		Effect.map((operation) => {
			assertCompleted(operation, `User lifecycle operation '${operation.id}'`);
			return operation;
		}),
	);
