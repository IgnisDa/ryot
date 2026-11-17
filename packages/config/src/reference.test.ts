import { describe, expect, it } from "bun:test";

import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { mapAppSchemaText } from "@ryot-app/contract/schema/property-schema";

import { defineConfig, definePluginConfig, group, stringField } from "./index";
import { renderConfigReference } from "./reference";

const packageId = PluginPackageId.make("ryot/fixture");

describe("config reference", () => {
	it("renders nested core and plugin metadata while omitting hidden fields", () => {
		const core = defineConfig({
			timezone: stringField({
				envKey: "TZ",
				label: "Timezone",
				defaultValue: "Etc/GMT",
				description: "Application timezone",
			}),
			server: group(
				{ label: "Server", description: "Server settings" },
				{
					hidden: stringField({
						hidden: true,
						label: "Hidden",
						envKey: "HIDDEN",
						description: "Internal value",
					}),
				},
			),
		});
		const plugin = definePluginConfig(packageId, {
			token: stringField({
				secret: true,
				defaultValue: "token",
				description: "Plugin token",
				label: { key: "test.token" },
			}),
		});
		const schema = mapAppSchemaText(plugin.schema, () => "Token");
		const markdown = renderConfigReference(core, [{ schema, packageId, name: "Fixture" }]);

		expect(markdown).toContain("# App Backend Configuration Reference");
		expect(markdown).toContain("### Server settings");
		expect(markdown).toContain(
			"| `timezone` | `TZ` | Application timezone | No | No | `Etc/GMT` |",
		);
		expect(markdown).toContain(
			"| `ryot/fixture.token` | `RYOT_PLUGIN__RYOT__FIXTURE__TOKEN` | Token | Plugin token | No | Yes | `token` |",
		);
		expect(markdown).not.toContain("HIDDEN");
	});
});
