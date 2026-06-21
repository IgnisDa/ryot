import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { SqlError, UniqueViolation } from "effect/unstable/sql/SqlError";

import { databaseError, isUniqueConstraintError } from "./service";

it("maps Effect SQL metadata to the application DbError", () => {
	const cause = Object.assign(new Error("duplicate"), {
		code: "23505",
		constraint: "users_email_unique",
	});
	const failure = new SqlError({
		reason: new UniqueViolation({
			cause,
			constraint: "users_email_unique",
			message: "duplicate",
			operation: "execute",
		}),
	});

	expect(databaseError(failure)).toEqual(
		new DbError({
			code: "23505",
			constraint: "users_email_unique",
			message: "duplicate",
		}),
	);
});

it("matches only the requested unique constraint", () => {
	const matchesEmailConstraint = isUniqueConstraintError("users_email_unique");

	expect(
		matchesEmailConstraint(
			new DbError({ code: "23505", constraint: "users_email_unique", message: "duplicate" }),
		),
	).toBe(true);
	expect(
		matchesEmailConstraint(
			new DbError({ code: "23505", constraint: "users_name_unique", message: "duplicate" }),
		),
	).toBe(false);
	expect(matchesEmailConstraint(new DbError({ code: "40001", message: "retry" }))).toBe(false);
});
