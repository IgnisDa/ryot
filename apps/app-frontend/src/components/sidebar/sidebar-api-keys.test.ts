import { describe, expect, it } from "bun:test";
import type { SidebarApiKey } from "./sidebar-api-keys";
import {
	formatSidebarApiKeyDate,
	getSidebarApiKeyDetails,
	getSidebarApiKeyDisplayName,
} from "./sidebar-api-keys";

function createApiKeyFixture(
	overrides: Partial<SidebarApiKey> = {},
): SidebarApiKey {
	return {
		id: "key-1",
		enabled: true,
		prefix: "ry_",
		start: "ry_abc",
		name: "Deploy key",
		...overrides,
	} as SidebarApiKey;
}

describe("sidebar api key helpers", () => {
	it("falls back to a default display name when name is blank", () => {
		const key = createApiKeyFixture({ name: "   " });

		expect(getSidebarApiKeyDisplayName(key)).toBe("Untitled key");
	});

	it("builds a single inline details row for list cards", () => {
		const key = createApiKeyFixture({
			start: "lvErmY",
			createdAt: "2026-03-01T10:00:00.000Z",
			expiresAt: "2026-03-20T10:00:00.000Z",
			lastRequest: "2026-03-11T10:00:00.000Z",
		});

		expect(getSidebarApiKeyDetails(key)).toEqual([
			{ label: null, value: "lvErmY" },
			{ label: "Created", value: "Mar 1, 2026" },
			{ label: "Last used", value: "Mar 11, 2026" },
		]);
	});

	it("formats missing dates with a readable fallback", () => {
		expect(formatSidebarApiKeyDate(null, "Never")).toBe("Never");
	});
});
