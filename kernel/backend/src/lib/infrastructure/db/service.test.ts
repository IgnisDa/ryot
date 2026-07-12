import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { Effect } from "effect";
import { SqlError, UniqueViolation } from "effect/unstable/sql/SqlError";

import { databaseError, isUniqueConstraintError, retryOnDeadlock } from "./service";

it("maps Effect SQL metadata to the application DbError", () => {
	const cause = Object.assign(new Error("duplicate"), {
		code: "23505",
		constraint: "users_email_unique",
	});
	const failure = new SqlError({
		reason: new UniqueViolation({
			cause,
			message: "duplicate",
			operation: "execute",
			constraint: "users_email_unique",
		}),
	});

	expect(databaseError(failure)).toEqual(
		new DbError({ code: "23505", message: "duplicate", constraint: "users_email_unique" }),
	);
});

it("matches only the requested unique constraint", () => {
	const matchesEmailConstraint = isUniqueConstraintError("users_email_unique");

	expect(
		matchesEmailConstraint(
			new DbError({ code: "23505", message: "duplicate", constraint: "users_email_unique" }),
		),
	).toBe(true);
	expect(
		matchesEmailConstraint(
			new DbError({ code: "23505", message: "duplicate", constraint: "users_name_unique" }),
		),
	).toBe(false);
	expect(matchesEmailConstraint(new DbError({ code: "40001", message: "retry" }))).toBe(false);
});

it.effect("retries a deadlocked transaction twice", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const result = yield* retryOnDeadlock(
			Effect.suspend(() => {
				attempts += 1;
				return attempts < 3
					? Effect.fail(new DbError({ code: "40P01", message: "deadlock" }))
					: Effect.succeed("committed");
			}),
		);

		expect(result).toBe("committed");
		expect(attempts).toBe(3);
	}),
);

it.effect("does not retry another database failure", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const error = yield* Effect.flip(
			retryOnDeadlock(
				Effect.suspend(() => {
					attempts += 1;
					return Effect.fail(new DbError({ code: "40001", message: "serialization" }));
				}),
			),
		);

		expect(error.code).toBe("40001");
		expect(attempts).toBe(1);
	}),
);
