import { EntitySchemaSlug, SandboxProviderId } from "@ryot-app/contract/schema/brands";
import { describe, expect, it } from "vitest";

import { selectPreferredProvider } from "./preferred-provider";
import type { ProviderSearchSummary } from "./state";

const provider = (id: string): ProviderSearchSummary => ({
	providerSlug: id,
	providerName: "Provider",
	searchOptionsSchema: null,
	providerId: SandboxProviderId.make(id),
	rootEntitySchemaSlug: EntitySchemaSlug.make("book"),
});

describe("selectPreferredProvider", () => {
	it("returns the remembered provider when it is available", () => {
		const providers = [provider("provider-1"), provider("provider-2")];

		expect(selectPreferredProvider(providers, providers[1].providerId)).toBe(providers[1]);
	});

	it("falls back to the first provider for a missing or null remembered provider", () => {
		const providers = [provider("provider-1"), provider("provider-2")];

		expect(selectPreferredProvider(providers, SandboxProviderId.make("provider-missing"))).toBe(
			providers[0],
		);
		expect(selectPreferredProvider(providers, null)).toBe(providers[0]);
	});

	it("returns undefined when there are no providers", () => {
		expect(selectPreferredProvider([], null)).toBeUndefined();
	});
});
