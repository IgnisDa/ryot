import { Config, Effect, Schema } from "effect";

export const TestTimeout = Schema.NumberFromString.check(
	Schema.isInt(),
	Schema.isGreaterThanOrEqualTo(0),
);

const configured = Effect.runSync(
	Config.schema(TestTimeout, "RYOT_TEST_TIMEOUT").pipe(Config.withDefault(5000)),
);

export const testTimeout = configured === 0 ? undefined : configured;
