import { expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import { PageWriteInput } from "./agent-tool";

const source = "export default () => <p>Café</p>;";
const input = (files: readonly { readonly path: string; readonly text: string }[]) => ({
	definition: { files, pluginDependencies: {}, entry: "client/page.tsx", queries: { queries: {} } },
});

it.effect(
	"stores page write text files as base64 and reads them back as text",
	() =>
		Effect.gen(function* () {
			const decoded = yield* Schema.decodeEffect(PageWriteInput)(
				input([{ text: source, path: "client/page.tsx" }]),
			);
			expect(decoded.definition.files).toEqual([
				{ path: "client/page.tsx", content: Buffer.from(source).toString("base64") },
			]);
			expect(yield* Schema.encodeEffect(PageWriteInput)(decoded)).toEqual(
				input([{ text: source, path: "client/page.tsx" }]),
			);
			yield* Effect.flip(
				Schema.encodeEffect(PageWriteInput)({
					definition: {
						...decoded.definition,
						files: [
							{ path: "client/logo.png", content: Buffer.from([0xff, 0xfe]).toString("base64") },
						],
					},
				}),
			);
		}),
	testTimeout,
);
