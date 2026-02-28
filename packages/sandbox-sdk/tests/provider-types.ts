import type { ScriptManifest } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineProvider, type ProviderResolveResult } from "@ryot/sandbox-sdk/provider";

import { defineManifest } from "../src/driver.js";
import type { Equal, Expect } from "./type-assertions.js";

const manifest = defineManifest({
	kind: "provider",
	name: "Typed provider",
	slug: "typed.provider",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["getCachedValue"],
});
const provider = defineProvider({
	manifest,
	operation: "resolve",
	run: (input, host) => {
		const inputType: Expect<Equal<typeof input.value, string>> = true;
		const hostType: Expect<Equal<keyof typeof host, "executeWorkflow" | "getCachedValue">> = true;
		void inputType;
		void hostType;
		return Effect.succeed({ externalId: null });
	},
});

const manifestType: Expect<Equal<typeof manifest extends ScriptManifest ? true : false, false>> =
	true;
const resolveType: Expect<
	Equal<Effect.Success<ReturnType<typeof provider.run>>, ProviderResolveResult>
> = true;
const externalIdType: Expect<Equal<ProviderResolveResult["externalId"], string | null>> = true;
void manifestType;
void resolveType;
void externalIdType;

defineProvider({
	manifest,
	operation: "resolve",
	// @ts-expect-error provider operations must return Effect values.
	run: () => Promise.resolve({ externalId: null }),
});
