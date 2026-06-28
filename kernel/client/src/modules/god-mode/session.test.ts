import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decodeServerOrigin } from "#/api/origin";
import { makeGodModeSessionService } from "#/modules/god-mode/session";

const origin = decodeServerOrigin("https://ryot.example");

describe("God Mode sessions", () => {
	it("stores a token behind an unrelated generated session id until cleared", () => {
		const ids = ["session-1", "session-2"];
		const sessions = makeGodModeSessionService(() => ids.shift() ?? "session-fallback");
		const sessionId = Effect.runSync(sessions.create(origin, "admin-secret"));

		expect(sessionId).toBe("session-1");
		expect(sessionId).not.toContain("admin-secret");
		expect(Effect.runSync(sessions.get(sessionId))).toEqual({ origin, token: "admin-secret" });
		expect(Effect.runSync(sessions.get("admin-secret"))).toBeNull();

		Effect.runSync(sessions.clear(sessionId));
		expect(Effect.runSync(sessions.get(sessionId))).toBeNull();
	});

	it("does not share sessions across service instances", () => {
		const first = makeGodModeSessionService(() => "session-1");
		const second = makeGodModeSessionService(() => "session-2");
		const sessionId = Effect.runSync(first.create(origin, "admin-secret"));

		expect(Effect.runSync(second.get(sessionId))).toBeNull();
	});

	it("regenerates an id when the random source collides", () => {
		const ids = ["session-1", "session-1", "session-2"];
		const sessions = makeGodModeSessionService(() => ids.shift() ?? "session-fallback");

		expect(Effect.runSync(sessions.create(origin, "token-1"))).toBe("session-1");
		expect(Effect.runSync(sessions.create(origin, "token-2"))).toBe("session-2");
		expect(Effect.runSync(sessions.get("session-1"))?.token).toBe("token-1");
		expect(Effect.runSync(sessions.get("session-2"))?.token).toBe("token-2");
	});
});
