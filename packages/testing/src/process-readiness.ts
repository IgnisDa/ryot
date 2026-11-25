import { Effect, Schedule, Schema } from "effect";
import { HttpClient } from "effect/http";

class ProcessNotReady extends Schema.TaggedError<
	ProcessNotReady,
	{ readonly brand: unique symbol }
>()("ProcessNotReady", { message: Schema.String }) {}

export const waitForHttpProcess = (
	url: string,
	label: string,
	process: Pick<Bun.Subprocess, "exitCode">,
) =>
	Effect.gen(function* () {
		if (process.exitCode !== null) {
			return yield* Effect.die(
				new Error(
					`[${label}] Process exited with code ${process.exitCode} before ${url} became healthy`,
				),
			);
		}
		const client = yield* HttpClient.HttpClient;
		const healthy = yield* client.get(url).pipe(
			Effect.map((response) => response.status >= 200 && response.status < 300),
			Effect.orElseSucceed(() => false),
		);
		if (!healthy) {
			return yield* new ProcessNotReady({
				message: `[${label}] Waiting for ${url} to become healthy`,
			});
		}
		return undefined;
	}).pipe(Effect.retry({ times: 89, schedule: Schedule.spaced("1 second") }), Effect.orDie);
