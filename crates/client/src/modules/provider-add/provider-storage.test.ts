import { describe, expect, it } from "vitest";

import { providerAddProviderStorageKey } from "./provider-storage";

describe("provider-add remembered provider persistence", () => {
	it("scopes its key by normalized server URL, user, and entity type", () => {
		const scope = { serverUrl: "https://one.test", userId: "user-1", entitySchemaSlug: "book" };

		expect(providerAddProviderStorageKey({ ...scope, serverUrl: " https://one.test/ " })).toBe(
			providerAddProviderStorageKey(scope),
		);
		expect(providerAddProviderStorageKey(scope)).toContain("provider-add:provider:");
		expect(providerAddProviderStorageKey({ ...scope, serverUrl: "https://two.test" })).not.toBe(
			providerAddProviderStorageKey(scope),
		);
		expect(providerAddProviderStorageKey({ ...scope, userId: "user-2" })).not.toBe(
			providerAddProviderStorageKey(scope),
		);
		expect(providerAddProviderStorageKey({ ...scope, entitySchemaSlug: "movie" })).not.toBe(
			providerAddProviderStorageKey(scope),
		);
	});
});
