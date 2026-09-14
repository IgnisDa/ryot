import type { ContractSuccess } from "@ryot-app/contract/client";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import { assertCompleted } from "~/support/assertions";

import { adminHeaders } from "./admin";
import { getApiClient } from "./contract-client";
import { pollUntil } from "./polling";

export type UserLifecycleOperation = ContractSuccess<"godMode", "getUserLifecycleOperation">;
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
		getApiClient()
			.call((c) => c.godMode.getUserLifecycleOperation({ params: { operationId } }), adminHeaders())
			.pipe(
				Effect.map((operation) =>
					operation.status === "completed" || operation.status === "failed" ? operation : null,
				),
			),
	);

export const deleteUserAndWait = (userId: string) =>
	requestUserDeletion(userId).pipe(
		Effect.flatMap((operation) => pollUserLifecycleOperation(operation.id)),
		Effect.map((operation) => {
			assertCompleted(operation, `User lifecycle operation '${operation.id}'`);
			return operation;
		}),
	);

export const resetUserAndWait = (userId: string) =>
	requestUserReset(userId).pipe(
		Effect.flatMap((operation) => pollUserLifecycleOperation(operation.id)),
		Effect.map((operation) => {
			assertCompleted(operation, `User lifecycle operation '${operation.id}'`);
			return operation;
		}),
	);
