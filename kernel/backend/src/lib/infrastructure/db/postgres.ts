import { PgClient } from "@effect/sql-pg";
import { Duration, Effect, Layer } from "effect";

import { AppConfig, databaseConnectionBudget } from "#lib/infrastructure/config/service";

export const PgClientLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		PgClient.layer({
			url: config.database.url,
			connectTimeout: Duration.millis(config.database.connectionTimeoutMs),
			maxConnections: Math.min(
				config.database.poolMax,
				databaseConnectionBudget(config).application,
			),
		}),
	),
);
