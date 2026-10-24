import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { SetCalendarSourceVisibilityBody } from "./schemas";

describe("calendar source visibility body", () => {
	it("accepts exact plugin source identities and rejects extra properties", () => {
		const decode = Schema.decodeUnknownSync(SetCalendarSourceVisibilityBody);
		expect(decode({ slug: "dates", isHidden: true, pluginId: "plugin-1" })).toEqual({
			slug: "dates",
			isHidden: true,
			pluginId: "plugin-1",
		});
		expect(() =>
			decode({ slug: "dates", isHidden: true, userId: "other", pluginId: "plugin-1" }),
		).toThrow();
		expect(() => decode({ slug: "dates", pluginId: "plugin-1" })).toThrow();
	});
});
