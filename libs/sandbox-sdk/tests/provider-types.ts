import { defineManifest, defineScript } from "@ryot/sandbox-sdk";
import { defineProvider, defineProviderDriver } from "@ryot/sandbox-sdk/provider";

import type { Equal, Expect } from "./type-assertions.js";

const manifest = defineManifest({
	kind: "provider",
	name: "Typed provider",
	slug: "typed.provider",
	requiredAppConfigKeys: [],
	capabilities: ["getCachedValue"],
	providerInformation: { source: "typed" },
});

const search = defineProviderDriver(manifest, "search", (input, host) => {
	const inputType: Expect<Equal<typeof input.query, string>> = true;
	const hostType: Expect<Equal<keyof typeof host, "getCachedValue">> = true;
	void inputType;
	void hostType;
	return Promise.resolve({
		items: [{ externalId: "result-1", titleProperty: { kind: "text", value: input.query } }],
	});
});

defineProvider({ manifest, drivers: { search } });

// @ts-expect-error provider manifests must use defineProvider.
defineScript({ manifest, drivers: { search } });

defineProviderDriver(
	manifest,
	"resolve",
	// @ts-expect-error resolve output must use a nullable externalId string.
	() => Promise.resolve({ externalId: 42 }),
);
