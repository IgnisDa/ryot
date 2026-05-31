import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { requireAccess, requireCustomAccess, requireReadAccess } from "./access";
import { SandboxRunError, ValidationError } from "./errors";

const resourceNotFound = () => new SandboxRunError({ message: "Resource not found" });

it.effect("returns readable scopes", () =>
	Effect.gen(function* () {
		const scope = { id: "resource-id" };
		const result = yield* requireReadAccess(resourceNotFound)(scope);

		expect(result).toBe(scope);
	}),
);

it.effect("fails missing scopes with the caller's not-found error", () =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(requireReadAccess(resourceNotFound)(undefined));

		expect(exit).toEqual(Exit.fail(resourceNotFound()));
	}),
);

it.effect("collapses failed ownership rules into caller-defined errors", () =>
	Effect.gen(function* () {
		const scope = { id: "resource-id", userId: "other-user-id" };
		const exit = yield* Effect.exit(
			requireAccess<typeof scope, SandboxRunError>({
				notFound: resourceNotFound,
				rules: [
					{
						error: resourceNotFound,
						test: (candidate) => candidate.userId === "user-id",
					},
				],
			})(scope),
		);

		expect(exit).toEqual(Exit.fail(resourceNotFound()));
	}),
);

it.effect("blocks built-in resources with a caller-defined mutation error", () =>
	Effect.gen(function* () {
		const builtin = { id: "resource-id", isBuiltin: true };
		const exit = yield* Effect.exit(
			requireCustomAccess({
				notFound: resourceNotFound,
				builtin: () => new ValidationError({ message: "Built-in resources cannot be modified" }),
			})(builtin),
		);

		expect(exit).toEqual(
			Exit.fail(new ValidationError({ message: "Built-in resources cannot be modified" })),
		);
	}),
);
