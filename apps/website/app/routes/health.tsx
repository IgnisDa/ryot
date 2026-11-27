import { sql } from "drizzle-orm";
import { Effect } from "effect";

import { getDb } from "~/server/config.server";
import { fromPromise } from "~/server/effect.server";
import { runMigrations } from "~/server/migrations.server";
import { runPromise } from "~/server/runtime.server";

let hasRunStartup = false;

export const loader = () =>
	runPromise(
		Effect.gen(function* () {
			if (!hasRunStartup) {
				yield* runMigrations();
				hasRunStartup = true;
			}
			yield* fromPromise(() => getDb().execute(sql`SELECT 1`));
			return new Response("OK");
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logError("Health check failed:", cause).pipe(
					Effect.as(new Response("Database connection failed", { status: 503 })),
				),
			),
		),
	);
