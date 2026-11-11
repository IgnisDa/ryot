import { expect, test } from "bun:test";

import { operationJsonSchema } from "@ryot-app/plugin-kit/operations";

import operation0 from "../backend/operations/greet.sandbox";
import plugin from "./plugin";

const scripts = [operation0];
test("publishes the input and output schemas used by every operation script", () => {
	expect(plugin.operations).toHaveLength(scripts.length);
	for (const script of scripts) {
		const operation = plugin.operations[0];
		expect(operation.scriptSlug).toBe(script.manifest.slug);
		expect(operation.input).toEqual<unknown>(operationJsonSchema(script.input));
		expect(operation.output).toEqual<unknown>(operationJsonSchema(script.output));
	}
});
