import { PgClient } from "@effect/sql-pg";
import { Duration, Effect, Layer } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

export const PgClientLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		PgClient.layer({
			url: config.database.url,
			maxConnections: config.database.poolMax,
			connectTimeout: Duration.millis(config.database.connectionTimeoutMs),
		}),
	),
);
