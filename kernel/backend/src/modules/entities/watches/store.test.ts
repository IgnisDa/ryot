import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import {
	ENTITY_WATCH_PROGRESSION_LEASE_SECONDS,
	ENTITY_WATCH_SESSION_RENEWAL_INTERVAL_SECONDS,
	ENTITY_WATCH_SESSION_TTL_SECONDS,
	redisKeys,
} from "#platform/redis";

describe("entity interest Redis keys", () => {
	it("uses the exact session and reverse-index keys", () => {
		expect(redisKeys.entityWatchSession("session-1")).toBe("ryot:entity-watches:session:session-1");
		expect(redisKeys.entityWatchSessionEntities("session-1")).toBe(
			"ryot:entity-watches:session:session-1:entities",
		);
		expect(redisKeys.entityWatchSessions("entity-1")).toBe(
			"ryot:entity-watches:entity:entity-1:sessions",
		);
		expect(redisKeys.entityWatchProgressionLease("entity-1")).toBe(
			"ryot:entity-watches:progress:entity-1",
		);
	});

	it("uses the session timing bounds", () => {
		expect(ENTITY_WATCH_SESSION_TTL_SECONDS).toBe(15 * 60);
		expect(ENTITY_WATCH_SESSION_RENEWAL_INTERVAL_SECONDS).toBe(5 * 60);
		expect(ENTITY_WATCH_PROGRESSION_LEASE_SECONDS).toBe(30);
	});
});
