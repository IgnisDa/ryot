import { PgClient } from "@effect/sql-pg";
import { Duration, Effect, Layer } from "effect";

import { AppConfig, databaseConnectionBudget } from "#platform/config/service";

export const PgClientLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		PgClient.layer({
			url: config.database.url,
			maxConnections: databaseConnectionBudget(config).application,
			connectTimeout: Duration.millis(config.database.connectionTimeoutMs),
		}),
	),
);
