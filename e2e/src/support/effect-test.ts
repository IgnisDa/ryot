import { afterAll, beforeAll, describe, expect } from "bun:test";

import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it as fullIt, type TestContext } from "@voila.dev/effect-bun-test";
import type { Effect, Scope } from "effect";

import { type E2eServices, provideE2eServices } from "./e2e-runtime";

export { assert, expect, afterAll, describe, beforeAll };
export { runPromise } from "./e2e-runtime";

export const it = Object.assign(
	(name: string, test: () => void, timeout?: number) => fullIt(name, test, timeout),
	{
		live: <A, E>(
			name: string,
			self: (context: TestContext) => Effect.Effect<A, E, Scope.Scope | E2eServices>,
			timeout = testTimeout,
		) => fullIt.live(name, (context) => provideE2eServices(self(context)), timeout),
	},
);
