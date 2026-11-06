import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { listEventsForEntity, waitForEventProjections } from "~/fixtures/kernel/events";

export const historyEventsFor = (client: Client, entityId: string) =>
	waitForEventProjections(client).pipe(
		Effect.andThen(listEventsForEntity(client, entityId, undefined, 100)),
	);
