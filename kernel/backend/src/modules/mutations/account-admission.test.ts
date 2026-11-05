import { expect } from "bun:test";

import { UserId } from "@ryot-app/contract/schema/brands";
import { makeRecordingTracer, recordedStatements } from "@ryot-app/testing/recording-tracer";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq } from "drizzle-orm";
import { Effect, type Tracer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { AccountAdmission } from "./account-admission";

layer(isolatedDatabaseLayer("account_admission_test"))((test) => {
	test.effect(
		"admits an account once per transaction and refuses a replaced or retiring generation",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const admission = yield* AccountAdmission.make;
				const account = { token: "admitted", userId: UserId.make("admitted-account") };
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							id: account.userId,
							name: account.userId,
							accountGeneration: account.token,
							email: `${account.userId}@example.test`,
						}),
				);
				const spans: Array<Tracer.Span> = [];
				yield* session
					.transaction(
						Effect.andThen(admission.admitAccount(account), admission.admitAccount(account)),
					)
					.pipe(Effect.withTracer(makeRecordingTracer(spans)));
				expect(
					recordedStatements(spans).filter((text) => text.includes('from "user"')),
				).toHaveLength(1);
				const refusal = (token: string) =>
					session.transaction(admission.admitAccount({ ...account, token })).pipe(
						Effect.flip,
						Effect.map((error) => error.message),
					);
				expect(yield* refusal("replaced")).toBe("Mutation command belongs to a retired account");
				yield* session.run((db) =>
					db
						.update(tables.user)
						.set({ retiringAccountGeneration: account.token })
						.where(eq(tables.user.id, account.userId)),
				);
				expect(yield* refusal(account.token)).toBe("Mutation command account is being retired");
			}),
		testTimeout,
	);
});
