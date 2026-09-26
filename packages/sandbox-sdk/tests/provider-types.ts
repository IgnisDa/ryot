import type { ScriptHost, ScriptManifest } from "@ryot-app/sandbox-sdk/core";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineProvider, type ProviderResolveResult } from "@ryot-app/sandbox-sdk/provider";

import { defineManifest } from "../src/driver.js";
import type { SandboxHostError } from "../src/wire.js";
import type { Equal, Expect } from "./type-assertions.js";

const manifest = defineManifest({
	kind: "provider",
	name: "Typed provider",
	slug: "typed.provider",
});
const provider = defineProvider({
	manifest,
	operation: "resolve",
	run: (input, host) => {
		const inputType: Expect<Equal<typeof input.value, string>> = true;
		const hostType: Expect<Equal<keyof typeof host, keyof ScriptHost>> = true;
		void inputType;
		void hostType;
		return host
			.getCachedValue(input.value)
			.pipe(
				Effect.flatMap((value) =>
					value === null
						? Effect.fail({ _tag: "MissingProviderValue" as const })
						: Effect.succeed({ externalId: input.value }),
				),
			);
	},
});

const manifestType: Expect<Equal<typeof manifest extends ScriptManifest ? true : false, false>> =
	true;
const resolveType: Expect<
	Equal<Effect.Success<ReturnType<typeof provider.run>>, { externalId: string }>
> = true;
const failureType: Expect<
	Equal<
		Effect.Error<ReturnType<typeof provider.run>>,
		SandboxHostError | { _tag: "MissingProviderValue" }
	>
> = true;
const externalIdType: Expect<Equal<ProviderResolveResult["externalId"], string | null>> = true;
void manifestType;
void resolveType;
void failureType;
void externalIdType;

defineProvider({
	manifest,
	operation: "resolve",
	// @ts-expect-error provider operations must return Effect values.
	run: () => Promise.resolve({ externalId: null }),
});
