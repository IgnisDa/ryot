import { defineManifest, type ScriptManifest } from "@ryot/sandbox-sdk/core";
import {
	defineProvider,
	defineProviderDriver,
	type ProviderResolveResult,
} from "@ryot/sandbox-sdk/provider";

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

const resolve = defineProviderDriver(manifest, "resolve", () =>
	Promise.resolve({ externalId: null }),
);

const provider = defineProvider({ manifest, drivers: { search, resolve } });

const manifestType: Expect<Equal<typeof manifest extends ScriptManifest ? true : false, false>> =
	true;
const resolveType: Expect<
	Equal<Awaited<ReturnType<typeof provider.drivers.resolve.run>>, ProviderResolveResult>
> = true;
const externalIdType: Expect<Equal<ProviderResolveResult["externalId"], string | null>> = true;
void manifestType;
void resolveType;
void externalIdType;
