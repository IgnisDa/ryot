import { expect, it } from "bun:test";

import { kernelScripts } from "./builtin-scripts";

it("ships the signal notification script as the only kernel script", () => {
	expect(kernelScripts.map(({ slug }) => slug)).toEqual(["automation.notification"]);
	expect(kernelScripts[0].inputProjection).toEqual({
		signal: { properties: ["providerName", "message", "entityTitle", "dueAt", "timezone"] },
	});
});
