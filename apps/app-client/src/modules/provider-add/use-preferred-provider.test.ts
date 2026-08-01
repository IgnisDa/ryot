import { EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import type { ProviderSearchSummary } from "@ryot/ryotql-recipes/provider-search";
import { describe, expect, it, vi } from "vitest";

import { selectPreferredProvider } from "./use-preferred-provider";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => undefined }));
vi.mock("@/api/scope", () => ({ useApiScope: () => undefined }));
vi.mock("@/api/use-internal-request-failure-logging", () => ({
	useInternalRequestFailureLogging: () => undefined,
}));
vi.mock("./atoms", () => ({
	providerSearchAtom: () => undefined,
	rememberedProviderAtom: () => undefined,
}));
vi.mock("./state", () => ({ mapProviderSummaries: () => undefined }));

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
