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
		"admits an account once per transaction and refuses a retiring or deleted account",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const admission = yield* AccountAdmission.make;
				const account = UserId.make("admitted-account");
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({ id: account, name: account, email: `${account}@example.test` }),
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
				const refusal = session.transaction(admission.admitAccount(account)).pipe(
					Effect.flip,
					Effect.map((error) => error.message),
				);
				yield* session.run((db) =>
					db.update(tables.user).set({ retiringAt: new Date() }).where(eq(tables.user.id, account)),
				);
				expect(yield* refusal).toBe("Mutation command account is being retired");
				yield* session.run((db) => db.delete(tables.user).where(eq(tables.user.id, account)));
				expect(yield* refusal).toBe("Mutation command belongs to a retired account");
			}),
		testTimeout,
	);
});
