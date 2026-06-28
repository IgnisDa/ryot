import { expect, it } from "@effect/vitest";
import { describe } from "vitest";

import {
	ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS,
	ENTITY_INTEREST_SESSION_RENEWAL_INTERVAL_SECONDS,
	ENTITY_INTEREST_SESSION_TTL_SECONDS,
	redisKeys,
} from "#lib/infrastructure/redis";

describe("entity interest Redis keys", () => {
	it("uses the exact session and reverse-index keys", () => {
		expect(redisKeys.entityInterestSession("session-1")).toBe(
			"ryot:entity-interest:session:session-1",
		);
		expect(redisKeys.entityInterestSessionEntities("session-1")).toBe(
			"ryot:entity-interest:session:session-1:entities",
		);
		expect(redisKeys.entityInterestSessions("entity-1")).toBe(
			"ryot:entity-interest:entity:entity-1:sessions",
		);
		expect(redisKeys.entityInterestProgressionLease("entity-1")).toBe(
			"ryot:entity-interest:progress:entity-1",
		);
	});

	it("uses the session timing bounds", () => {
		expect(ENTITY_INTEREST_SESSION_TTL_SECONDS).toBe(15 * 60);
		expect(ENTITY_INTEREST_SESSION_RENEWAL_INTERVAL_SECONDS).toBe(5 * 60);
		expect(ENTITY_INTEREST_PROGRESSION_LEASE_SECONDS).toBe(30);
	});
});
