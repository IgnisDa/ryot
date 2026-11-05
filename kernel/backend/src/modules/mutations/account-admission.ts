import { DbError } from "@ryot-app/contract/errors";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { user } from "#schema/tables/auth";

const mutationOwner = (command: LifecycleCommand, scopeUserId: null | UserId) =>
	command.accountGeneration?.userId ??
	(command.causation.source !== "automation" && command.causation.initiator.kind === "user"
		? command.causation.initiator.id
		: scopeUserId);

export const mutationUserIds = (command: LifecycleCommand, scopeUserId: null | UserId) =>
	[mutationOwner(command, scopeUserId), scopeUserId].filter((id) => id !== null);

// Admissions within one transaction share its `for share` lock on the user row, which account
// retirement must take exclusively, so each account needs admitting once per transaction.
const admittedAccounts = new WeakMap<object, Set<string>>();

export class AccountAdmission extends Context.Service<AccountAdmission>()(
	"@ryot-app/kernel-backend/modules/mutations/account-admission/AccountAdmission",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const requireTransaction = session.requireTransaction.pipe(
				Effect.mapError(() => new DbError({ message: "Account admission requires a transaction" })),
			);
			const admitAccount = Effect.fn("AccountAdmission.admitAccount")(function* (
				account: AccountGeneration,
			) {
				yield* requireTransaction;
				yield* session.run((db) =>
					Effect.gen(function* () {
						const key = stableStringify([account.userId, account.token]);
						const admitted = admittedAccounts.get(db) ?? new Set<string>();
						if (admitted.has(key)) {
							return yield* Effect.void;
						}
						// Retirement stamps this row under its exclusive lock, so the lock wait re-reads it.
						const [current] = yield* db
							.select({ token: user.accountGeneration, retiring: user.retiringAccountGeneration })
							.from(user)
							.where(eq(user.id, account.userId))
							.for("share");
						if (!current || current.token !== account.token) {
							return yield* new DbError({
								message: "Mutation command belongs to a retired account",
							});
						}
						if (current.retiring === account.token) {
							return yield* new DbError({ message: "Mutation command account is being retired" });
						}
						admitted.add(key);
						admittedAccounts.set(db, admitted);
						return yield* Effect.void;
					}),
				);
			});
			const admitCommand = Effect.fn("AccountAdmission.admitCommand")(function* (
				command: LifecycleCommand,
				scopeUserId: null | UserId,
			) {
				const account = command.accountGeneration;
				const owner = mutationOwner(command, scopeUserId);
				if (account === null) {
					return owner === null && scopeUserId === null
						? undefined
						: yield* new DbError({ message: "Mutation command account generation is missing" });
				}
				if (scopeUserId !== null && scopeUserId !== account.userId) {
					return yield* new DbError({
						message: "Mutation command account identity does not match its scope",
					});
				}
				return yield* admitAccount(account);
			});
			const currentAccount = Effect.fn("AccountAdmission.currentAccount")(function* (
				userId: UserId,
			) {
				const [current] = yield* session.run((db) =>
					db.select({ token: user.accountGeneration }).from(user).where(eq(user.id, userId)),
				);
				if (!current) {
					return yield* new DbError({ message: "Mutation command account is unavailable" });
				}
				const account = { userId, token: current.token };
				const admit = admitAccount(account);
				yield* Effect.flatMap(session.isTransactionActive, (active) =>
					active
						? admit
						: session
								.transaction(admit)
								.pipe(
									Effect.catchTag("DatabaseSessionStateError", () =>
										Effect.fail(
											new DbError({ message: "Mutation admission transaction could not start" }),
										),
									),
								),
				);
				return account;
			});
			return { admitAccount, admitCommand, currentAccount };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
