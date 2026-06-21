import { defineManifest } from "@ryot/sandbox-sdk";
import {
	type BeforeCreateTriggerResult,
	defineAfterCreateTrigger,
	defineBeforeCreateTrigger,
} from "@ryot/sandbox-sdk/trigger";

import type { Equal, Expect } from "./type-assertions.js";

const beforeManifest = defineManifest({
	kind: "trigger",
	mode: "before_create",
	requiredAppConfigKeys: [],
	name: "Typed before trigger",
	slug: "trigger.typed-before",
	capabilities: ["getCachedValue"],
});

const before = defineBeforeCreateTrigger({
	manifest: beforeManifest,
	run: (input, host) => {
		const phaseType: Expect<Equal<typeof input.trigger.phase, "before_create">> = true;
		const hostType: Expect<Equal<keyof typeof host, "getCachedValue">> = true;
		void phaseType;
		void hostType;
		return Promise.resolve({ action: "allow" });
	},
});

const afterManifest = defineManifest({
	kind: "trigger",
	capabilities: [],
	mode: "after_create",
	requiredAppConfigKeys: [],
	name: "Typed after trigger",
	slug: "trigger.typed-after",
});

const after = defineAfterCreateTrigger({
	manifest: afterManifest,
	run: (input) => {
		const phaseType: Expect<Equal<typeof input.trigger.phase, "after_create">> = true;
		void phaseType;
		return Promise.resolve();
	},
});

const beforeResultType: Expect<
	Equal<Awaited<ReturnType<typeof before.drivers.trigger.run>>, BeforeCreateTriggerResult>
> = true;
const afterResultType: Expect<Equal<Awaited<ReturnType<typeof after.drivers.trigger.run>>, void>> =
	true;
void beforeResultType;
void afterResultType;
