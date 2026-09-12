import { Effect } from "effect";

import type { CronTask } from "#modules/scheduler/types";

import { OAuthConnectionsService } from "./service";

export const oauthConnectionsFrequentTask: CronTask<never, OAuthConnectionsService> = {
	name: "oauth-connections-cleanup",
	run: () =>
		Effect.gen(function* () {
			yield* (yield* OAuthConnectionsService).deleteExpired(100);
		}).pipe(
			Effect.catchCause((cause) => Effect.logWarning("OAuth connection cleanup failed", cause)),
		),
};
