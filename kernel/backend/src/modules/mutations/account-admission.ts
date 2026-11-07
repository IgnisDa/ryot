import { DbError } from "@ryot-app/contract/errors";
import type { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import { CurrentJobId } from "#platform/jobs/worker";
import { user } from "#schema/tables/auth";
import { job } from "#schema/tables/jobs";

const mutationOwner = (command: LifecycleCommand, scopeUserId: null | UserId) =>
	command.accountUserId ??
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
			const admitAccount = Effect.fn("AccountAdmission.admitAccount")(function* (userId: UserId) {
				yield* requireTransaction;
				const jobId = yield* CurrentJobId;
				yield* session.run((db) =>
					Effect.gen(function* () {
						const admitted = admittedAccounts.get(db) ?? new Set<string>();
						if (admitted.has(userId)) {
							return yield* Effect.void;
						}
						// Retirement stamps this row under its exclusive lock, so the lock wait re-reads it, and
						// deletes the account's jobs in the transaction that holds it.
						const [current] = yield* db
							.select({
								retiringAt: user.retiringAt,
								jobAlive:
									jobId === null
										? sql<boolean>`true`
										: sql<boolean>`exists (select 1 from ${job} where ${job.id} = ${jobId})`,
							})
							.from(user)
							.where(eq(user.id, userId))
							.for("share", { of: user });
						if (!current?.jobAlive) {
							return yield* new DbError({
								message: "Mutation command belongs to a retired account",
							});
						}
						if (current.retiringAt !== null) {
							return yield* new DbError({ message: "Mutation command account is being retired" });
						}
						admitted.add(userId);
						admittedAccounts.set(db, admitted);
						return yield* Effect.void;
					}),
				);
			});
			const admitCommand = Effect.fn("AccountAdmission.admitCommand")(function* (
				command: LifecycleCommand,
				scopeUserId: null | UserId,
			) {
				const account = command.accountUserId;
				const owner = mutationOwner(command, scopeUserId);
				if (account === null) {
					return owner === null && scopeUserId === null
						? undefined
						: yield* new DbError({ message: "Mutation command account is missing" });
				}
				if (scopeUserId !== null && scopeUserId !== account) {
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
					db.select({ token: user.id }).from(user).where(eq(user.id, userId)),
				);
				if (!current) {
					return yield* new DbError({ message: "Mutation command account is unavailable" });
				}
				const admit = admitAccount(userId);
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
				return userId;
			});
			return { admitAccount, admitCommand, currentAccount };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
