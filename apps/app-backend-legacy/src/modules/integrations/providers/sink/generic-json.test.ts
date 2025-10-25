import { describe, expect, it } from "bun:test";

import { parseGenericJsonSink } from "./generic-json";
import { makeSinkIntegration } from "./test-utils";

describe("parseGenericJsonSink", () => {
	it("returns the not implemented source_fetch failure", async () => {
		const result = await parseGenericJsonSink({
			rawBody: "{}",
			contentType: "application/json",
			integration: makeSinkIntegration({
				provider: "generic_json",
				providerSpecifics: { kind: "generic_json" },
			}),
		});

		expect(result.entityGroups).toEqual([]);
		expect(result.failures).toEqual([
			{
				itemIndex: 0,
				stage: "source_fetch",
				message: "Generic JSON integration is not implemented in V2 yet",
			},
		]);
	});
});
