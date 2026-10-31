import { expect, it } from "@effect/vitest";
import * as sandboxRyotql from "@ryot-app/plugin-backend-sdk/ryotql";
import * as pluginKitRyotql from "@ryot-app/plugin-kit/ryotql";

it("provides every plugin-kit RyotQL runtime export through the aliased sandbox module", () => {
	expect(
		Object.keys(pluginKitRyotql).filter((name) => !Object.hasOwn(sandboxRyotql, name)),
	).toEqual([]);
});
