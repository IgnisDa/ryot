import type { ContractSuccess } from "@ryot-app/contract/client";
import type { UserLifecycleOperation } from "@ryot-app/contract/modules/instance-admin/user-lifecycle";
import { UserId } from "@ryot-app/contract/schema/brands";
import { userLifecycleOperationRecipe } from "@ryot-app/ryotql-recipes/instance-admin";
import { Effect, Option } from "effect";

import { assertCompleted } from "~/support/assertions";
import { getSharedHarnessTarget } from "~/support/harness-target";

import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";
import { executeAdminRyotQLRecipe } from "./ryotql";

export type DeleteUserOperation = ContractSuccess<"instanceAdmin", "deleteUser">;

const requestUserDeletion = (userId: string, target = getSharedHarnessTarget()) =>
	getApiClient(target).adminCall((c) =>
		c.instanceAdmin.deleteUser({ params: { userId: UserId.make(userId) } }),
	);

export const requestUserReset = (userId: string, target = getSharedHarnessTarget()) =>
	getApiClient(target).adminCall((c) =>
		c.instanceAdmin.resetUser({ params: { userId: UserId.make(userId) } }),
	);

export const pollUserLifecycleOperation = (
	operationId: UserLifecycleOperation["id"],
	target = getSharedHarnessTarget(),
) =>
	pollUntil(
		`User lifecycle operation '${operationId}' to complete`,
		executeAdminRyotQLRecipe(userLifecycleOperationRecipe({ id: operationId }), target).pipe(
			Effect.map((detail) => {
				const operation = Option.getOrNull(detail);
				return operation?.status === "completed" || operation?.status === "failed"
					? operation
					: null;
			}),
		),
	);

export const deleteUserAndWait = (userId: string, target = getSharedHarnessTarget()) =>
	requestUserDeletion(userId, target).pipe(
		Effect.flatMap(({ operationId }) => pollUserLifecycleOperation(operationId, target)),
		Effect.map((operation) => {
			assertCompleted(operation, `User lifecycle operation '${operation.id}'`);
			return operation;
		}),
	);

export const resetUserAndWait = (userId: string, target = getSharedHarnessTarget()) =>
	requestUserReset(userId, target).pipe(
		Effect.flatMap(({ operationId }) => pollUserLifecycleOperation(operationId, target)),
		Effect.map((operation) => {
			assertCompleted(operation, `User lifecycle operation '${operation.id}'`);
			return operation;
		}),
	);
