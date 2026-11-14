import { expect } from "bun:test";

import * as sandboxRyotql from "@ryot-app/plugin-backend-sdk/ryotql";
import * as pluginKitRyotql from "@ryot-app/plugin-kit/ryotql";
import { it } from "@voila.dev/effect-bun-test";

it("provides every plugin-kit RyotQL runtime export through the aliased sandbox module", () => {
	expect(
		Object.keys(pluginKitRyotql).filter((name) => !Object.hasOwn(sandboxRyotql, name)),
	).toEqual([]);
});
