import { BunServices } from "@effect/platform-bun";
import { sql } from "drizzle-orm";
import { Effect, FileSystem, Schema } from "effect";

import { getDb, getServerVariables, TEMP_DIRECTORY } from "~/lib/config.server";
import { fromPromise } from "~/lib/effect.server";
import { runMigrations } from "~/lib/migrations.server";

let hasRunStartup = false;

export const loader = () =>
	Effect.runPromise(
		Effect.gen(function* () {
			if (!hasRunStartup) {
				yield* runMigrations();
				const fs = yield* FileSystem.FileSystem;
				yield* fs.writeFileString(
					`${TEMP_DIRECTORY}/website-config.json`,
					yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(getServerVariables()),
				);
				hasRunStartup = true;
			}
			yield* fromPromise(() => getDb().execute(sql`SELECT 1`));
			return new Response("OK", { status: 200 });
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.gen(function* () {
					yield* Effect.logError("Health check failed:", cause);
					return new Response("Database connection failed", { status: 503 });
				}),
			),
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- React Router loader is the runtime entrypoint for the platform filesystem
			Effect.provide(BunServices.layer),
		),
	);
