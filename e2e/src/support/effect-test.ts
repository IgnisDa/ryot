import { afterAll, assert, beforeAll, describe, expect, it as fullIt } from "@effect/vitest";
import type { Effect, Scope } from "effect";
import type { TestContext } from "vitest";

import { type E2eServices, provideE2eServices } from "./e2e-runtime";

export { afterAll, assert, beforeAll, describe, expect };
export { runPromise } from "./e2e-runtime";

export const it = Object.assign(
	(name: string, test: () => void, timeout?: number) => fullIt(name, test, timeout),
	{
		live: <A, E>(
			name: string,
			self: (context: TestContext) => Effect.Effect<A, E, Scope.Scope | E2eServices>,
			timeout?: number,
		) => fullIt.live(name, (context) => provideE2eServices(self(context)), timeout),
	},
);
