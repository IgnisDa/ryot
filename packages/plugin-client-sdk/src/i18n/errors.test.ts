import { describe, expect, it } from "bun:test";

import { BadRequest, validationFailed } from "@ryot-app/contract/errors";
import type { Message } from "@ryot-app/i18n/message";
import { Text } from "@ryot-app/i18n/text";

import { RyotClientError } from "../client/errors";
import { formatError, validationIssuesOf } from "./errors";

const t = (message: Message) => Text(`${message.namespace}:${message.key}`);
const rejection = { namespace: "fixture", key: "operation.rejected" };

describe("formatError", () => {
	it("renders an operation rejection and the message reason of a wrapped contract error", () => {
		expect<string>(
			formatError(t, new RyotClientError({ rejection, reason: "operation-rejected" })),
		).toBe("fixture:operation.rejected");
		expect<string>(
			formatError(t, { cause: new BadRequest({ reason: { key: "a.b", namespace: "kernel" } }) }),
		).toBe("kernel:a.b");
	});

	it("falls back to rendered text, a message or the kernel default", () => {
		const failure = new RyotClientError({ reason: "operation-failed" });
		expect<string>(formatError(t, failure, Text("Refused"))).toBe("Refused");
		expect<string>(formatError(t, new Error("network"), { key: "x.y", namespace: "kernel" })).toBe(
			"kernel:x.y",
		);
		expect<string>(formatError(t, undefined)).toBe("kernel:error.internal.unexpected");
	});
});

it("retains server validation paths through transport error causes", () => {
	const issues = [{ issue: "missing-key" as const, path: ["field.with.dots", 1, "name"] }];
	expect(validationIssuesOf({ cause: { cause: validationFailed(issues) } })).toEqual(issues);
	expect(validationIssuesOf(new Error("Network"))).toEqual([]);
});
