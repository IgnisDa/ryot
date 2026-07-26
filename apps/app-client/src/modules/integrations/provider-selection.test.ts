import { describe, expect, it } from "vitest";

import { sinkProvider, unavailableProvider, yankProvider } from "./integration-fixture";
import {
	findOwnedIntegrationProvider,
	integrationLotDetail,
	integrationLotLabel,
	integrationProviderChooseLabel,
	integrationProviderEntry,
} from "./provider-selection";

describe("provider selection", () => {
	it("labels each lot by what it does rather than its slug", () => {
		expect(integrationLotLabel("yank")).toBe("Scheduled");
		expect(integrationLotLabel("sink")).toBe("Webhook");
		expect(integrationLotLabel("push")).toBe("Push");
	});

	it("explains how each lot will run", () => {
		expect(integrationLotDetail("sink")).toMatch(/webhook URL/);
		expect(integrationLotDetail("yank")).toMatch(/on a schedule/);
		expect(integrationLotDetail("push")).toMatch(/pushes changes out/);
	});

	it("maps a provider onto a catalog entry carrying its lot badge", () => {
		expect(integrationProviderEntry(yankProvider)).toEqual({
			slug: "komga",
			name: "Komga",
			isAvailable: true,
			badge: "Scheduled",
			requirement: undefined,
			description: yankProvider.description,
		});
	});

	it("explains why an unavailable provider cannot be chosen", () => {
		expect(integrationProviderEntry(unavailableProvider).requirement).toBe(
			"This service is not ready on your server yet.",
		);
	});

	it("names the action differently when a provider cannot be chosen", () => {
		expect(integrationProviderChooseLabel(integrationProviderEntry(yankProvider))).toBe(
			"Connect Komga",
		);
		expect(integrationProviderChooseLabel(integrationProviderEntry(unavailableProvider))).toBe(
			"Emby is unavailable",
		);
	});

	it("matches an owned provider on both slug and plugin", () => {
		const providers = [yankProvider, sinkProvider];

		expect(
			findOwnedIntegrationProvider(providers, { provider: "kodi", pluginSlug: "media" })?.name,
		).toBe("Kodi");
		expect(
			findOwnedIntegrationProvider(providers, { provider: "kodi", pluginSlug: "other" }),
		).toBeUndefined();
		expect(findOwnedIntegrationProvider(providers, undefined)).toBeUndefined();
	});
});
