import {
	defineDriver,
	defineManifest,
	type JsonValue,
	jsonValueSchema,
	z,
} from "@ryot/sandbox-sdk";

const allCapabilitiesManifest = defineManifest({
	kind: "script",
	name: "All core capabilities",
	slug: "all-core-capabilities",
	requiredAppConfigKeys: ["timezone"],
	capabilities: [
		"httpCall",
		"getCachedValue",
		"setCachedValue",
		"claimCachedValue",
		"getAppConfigValue",
		"getUserPreferences",
	],
});

defineDriver(allCapabilitiesManifest, {
	input: z.object({}),
	output: z.boolean(),
	run: async (_input, host) => {
		const http = await host.httpCall("POST", "https://example.com", {
			body: "payload",
			headers: { Accept: "application/json" },
		});
		if (http.success) {
			const status: number = http.data.status;
			const headers: Record<string, string> = http.data.headers;
			void headers;
			void status;
		} else if (http.data) {
			const status: number = http.data.status;
			void status;
		}

		const cached = await host.getCachedValue("key");
		if (cached.success) {
			const value: JsonValue | null = cached.data;
			void value;
		}

		const stored = await host.setCachedValue("key", { nested: [true] }, 60);
		if (stored.success) {
			const value: null = stored.data;
			void value;
		}

		const claim = await host.claimCachedValue("key", "value", 60);
		if (claim.success && !claim.data.claimed) {
			const value: JsonValue | null = claim.data.value;
			void value;
		}

		const config = await host.getAppConfigValue("timezone");
		if (config.success) {
			const value: JsonValue = config.data;
			void value;
		}

		const preferences = await host.getUserPreferences();
		if (preferences.success) {
			const isNsfw: boolean = preferences.data.isNsfw;
			void isNsfw;
		}

		// @ts-expect-error httpCall options require a string body.
		await host.httpCall("POST", "https://example.com", { body: 42 });

		return true;
	},
});

const narrowedManifest = defineManifest({
	kind: "script",
	requiredAppConfigKeys: [],
	name: "Narrowed capabilities",
	slug: "narrowed-capabilities",
	capabilities: ["getCachedValue"],
});

defineDriver(narrowedManifest, {
	input: z.object({}),
	output: jsonValueSchema.nullable(),
	run: async (_input, host) => {
		const result = await host.getCachedValue("key");

		// @ts-expect-error setCachedValue was not declared by this manifest.
		await host.setCachedValue("key", null, 60);

		return result.success ? result.data : null;
	},
});
