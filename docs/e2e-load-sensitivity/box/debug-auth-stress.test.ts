import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel";
import { updateUserSettingsPreferences } from "~/fixtures/kernel/user-settings";
import { describe, expect, it } from "~/support/effect-test";

const WORKERS = Number(process.env.DEBUG_WORKERS ?? 16);
const DURATION_MS = Number(process.env.DEBUG_DURATION_MS ?? 120000);

describe("debug auth stress", () => {
	it.live(
		"signs up users while patching preferences",
		() =>
			Effect.gen(function* () {
				const deadline = Date.now() + DURATION_MS;
				const stats = { signups: 0, signupFailures: 0, patches: 0, patchFailures: 0 };
				const failures: string[] = [];
				yield* Effect.forEach(
					Array.from({ length: WORKERS }, (_, i) => i),
					(worker) =>
						Effect.gen(function* () {
							while (Date.now() < deadline) {
								const signedUp = yield* Effect.result(createAuthenticatedClient());
								if (signedUp._tag === "Failure") {
									stats.signupFailures++;
									failures.push(`signup w${worker}: ${String(signedUp.failure).slice(0, 300)}`);
									continue;
								}
								stats.signups++;
								for (let n = 0; n < 5; n++) {
									const patched = yield* Effect.result(
										updateUserSettingsPreferences(signedUp.success.client, { allowNsfw: n % 2 === 0 }),
									);
									if (patched._tag === "Failure") {
										stats.patchFailures++;
										failures.push(`patch w${worker}: ${String(patched.failure).slice(0, 300)}`);
									} else stats.patches++;
								}
							}
						}).pipe(Effect.catchCause((cause) => Effect.sync(() => failures.push(`defect w${worker}: ${String(cause).slice(0, 300)}`)))),
					{ concurrency: "unbounded" },
				);
				console.log(`DEBUG-STRESS ${JSON.stringify(stats)}`);
				for (const failure of failures.slice(0, 40)) console.log(`DEBUG-STRESS-FAIL ${failure}`);
				expect(stats.signups).toBeGreaterThan(0);
				expect(failures).toEqual([]);
			}),
		DURATION_MS + 120000,
	);
});
