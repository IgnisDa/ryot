import { BadRequest, Conflict, NotFound } from "@ryot/contract/errors";
import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import {
	requestFailureMessage,
	requestFailureCopy,
	resolveRequestFailure,
	type RequestFailureRule,
} from "./request-failure";

const copy = { title: "Unable to load imports", subject: "Your import history" };

const rules: readonly RequestFailureRule<"pick" | "configure">[] = [
	{
		step: "configure",
		detail: "Check the details.",
		matches: (message) => message.startsWith("Invalid"),
	},
	{
		step: "pick",
		detail: "Choose another service.",
		matches: (message) => message.includes("not registered"),
	},
];

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

	it("reads the message only from a failure the server explained", () => {
		expect(requestFailureMessage(Cause.fail(new BadRequest({ message: "nope" })))).toBe("nope");
		expect(requestFailureMessage(Cause.fail(new Conflict({ message: "busy" })))).toBe("busy");
		expect(requestFailureMessage(Cause.fail(new NotFound({ message: "gone" })))).toBe("gone");
		expect(requestFailureMessage(Cause.fail(new Error("boom")))).toBeUndefined();
	});

	it("routes a recognized message to the step that can fix it", () => {
		expect(resolveRequestFailure(rules, "Invalid providerSpecifics", "fallback")).toEqual({
			step: "configure",
			detail: "Check the details.",
		});
		expect(resolveRequestFailure(rules, "provider 'x' is not registered", "fallback").step).toBe(
			"pick",
		);
	});

	it("keeps the user in place for an unknown or absent message", () => {
		expect(resolveRequestFailure(rules, "something else", "fallback")).toEqual({
			step: undefined,
			detail: "fallback",
		});
		expect(resolveRequestFailure(rules, undefined, "fallback").step).toBeUndefined();
	});
});
