import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ryot } from "./ryot";

const Greeting = Schema.Struct({ greeting: Schema.String });

describe("ryot.data.invokeOperation", () => {
	it("rejects with reason transport when no bridge has been bound", async () => {
		await expect(
			ryot.data.invokeOperation({ slug: "greet", input: {}, output: Greeting }),
		).rejects.toMatchObject({ reason: "transport" });
	});
});
