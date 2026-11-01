import { expect, it } from "@effect/vitest";

import { oauthRevisionPackage } from "../packages/revision.test-support";
import { fixtureManifest } from "../test-support";
import { availablePluginConfigKeys, ingestionReadinessMetadata } from "./readiness-metadata";

it("includes valid false and zero defaults without exposing configuration values", () => {
	const metadata = ingestionReadinessMetadata(
		{
			...fixtureManifest(),
			configSchema: {
				fields: {
					secret: { secret: true, type: "string", label: "Secret", description: "Secret" },
					enabled: {
						type: "boolean",
						label: "Enabled",
						defaultValue: false,
						description: "Enabled",
					},
					threshold: {
						type: "integer",
						defaultValue: 0,
						label: "Threshold",
						description: "Threshold",
					},
					invalid: {
						type: "integer",
						label: "Invalid",
						defaultValue: -1,
						description: "Invalid",
						validation: { minimum: 0 },
					},
				},
			},
		},
		[],
		false,
	);
	expect(metadata.availableConfigKeys).toEqual(["enabled", "threshold"]);
	expect(metadata).not.toHaveProperty("configSchema");
});

it("does not replace an empty configured OAuth client value with a schema default", () => {
	const fixture = oauthRevisionPackage("oauth-availability", "oauth-yank").manifest;
	const manifest = {
		...fixture,
		configSchema: {
			...fixture.configSchema,
			fields: {
				...fixture.configSchema.fields,
				clientId: { ...fixture.configSchema.fields.clientId, defaultValue: "default-client" },
			},
		},
	};
	const keys = availablePluginConfigKeys(manifest.configSchema, manifest.oauthProviders, {
		clientId: "",
		clientSecret: "secret",
	});
	expect(keys).toEqual(["clientSecret"]);
	expect(ingestionReadinessMetadata(manifest, keys, true).availableConfigKeys).toEqual([
		"clientSecret",
	]);
	expect(ingestionReadinessMetadata(manifest, [], false).availableConfigKeys).toEqual(["clientId"]);
});
