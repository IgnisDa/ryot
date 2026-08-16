import { describe, expect, it } from "vitest";

import { analyticsHostname, umamiEndpoint, umamiRequestBody } from "./payload";

const settings = { hostUrl: "https://umami.example.com", websiteId: "website-id" };

const environment = {
	referrer: "",
	screen: "390x844",
	language: "en-US",
	hostname: "app.ryot.io",
};

describe("umamiEndpoint", () => {
	it("appends the collect path and drops trailing slashes", () => {
		expect(umamiEndpoint("https://umami.example.com//")).toBe("https://umami.example.com/api/send");
	});
});

describe("analyticsHostname", () => {
	it("reduces a server URL to its hostname", () => {
		expect(analyticsHostname("https://app.ryot.io/ryot")).toBe("app.ryot.io");
	});

	it("falls back to the raw value when the server URL is unparseable", () => {
		expect(analyticsHostname("not-a-url")).toBe("not-a-url");
	});
});

describe("umamiRequestBody", () => {
	it("omits the name so a bare payload is recorded as a page view", () => {
		const body = umamiRequestBody({ settings, environment, event: { url: "/settings" } });
		expect(body.payload).not.toHaveProperty("name");
		expect(body.payload).not.toHaveProperty("data");
		expect(body).toMatchObject({
			type: "event",
			payload: {
				url: "/settings",
				language: "en-US",
				screen: "390x844",
				title: "/settings",
				website: "website-id",
				hostname: "app.ryot.io",
			},
		});
	});

	it("includes the name and data for a custom event", () => {
		const body = umamiRequestBody({
			settings,
			environment,
			event: { url: "/imports", name: "Deploy Import", data: { source: "trakt" } },
		});
		expect(body.payload).toMatchObject({ name: "Deploy Import", data: { source: "trakt" } });
	});

	it("prefers an explicit title over the url", () => {
		const body = umamiRequestBody({
			settings,
			environment,
			event: { url: "/imports", title: "Imports" },
		});
		expect(body.payload.title).toBe("Imports");
	});
});
