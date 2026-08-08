import { describe, expect, it } from "vitest";

import { requestFailureCopy } from "./request-failure";

const copy = { title: "Unable to load imports", subject: "Your import history" };

describe("request failure", () => {
	it("tells an unreachable server apart from an un-displayable answer", () => {
		expect(requestFailureCopy({ status: "transport-error" }, copy).detail).toBe(
			"Your import history could not be loaded. Check the server and try again.",
		);
		expect(requestFailureCopy({ status: "malformed" }, copy).detail).toBe(
			"Your import history came back in a form that could not be displayed. Try again later.",
		);
		expect(requestFailureCopy({ status: "malformed" }, copy).title).toBe(copy.title);
	});
});
