import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import {
	BACKGROUND_SUBMISSION_KEY_MAX_LENGTH,
	BACKGROUND_SUBMISSION_LIMITS,
} from "./background-submissions";
import { PluginBridgeClientMessage, PluginBridgeHostMessage } from "./messages";

const rejection = { namespace: "fixture", key: "operation.rejected" };

const decodeClient = Schema.decodeUnknownResult(PluginBridgeClientMessage);
const decodeHost = Schema.decodeUnknownResult(PluginBridgeHostMessage);

const request = {
	requestId: "request-1",
	idempotencyKey: "key-1",
	packageId: "test/fixture",
	operationSlug: "log-activity",
	input: { entityId: "entity-1" },
	type: "background-operation-request",
	submittedAt: "2026-10-19T00:00:00.000Z",
	label: { key: "activity.logged", params: { episode: 3 } },
};

describe("background submission bridge contract", () => {
	it("pins the shared in-flight and tray limits", () => {
		expect(BACKGROUND_SUBMISSION_LIMITS).toEqual({
			entries: 20,
			inFlightPerService: 8,
			inFlightPerSession: 4,
		});
	});

	it("admits a labelled request with a bounded idempotency key from the plugin only", () => {
		expect(Result.isSuccess(decodeClient(request))).toBe(true);
		expect(Result.isFailure(decodeHost(request))).toBe(true);
		const { idempotencyKey: _key, ...withoutKey } = request;
		expect(Result.isFailure(decodeClient(withoutKey))).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, idempotencyKey: "" }))).toBe(true);
		expect(
			Result.isSuccess(
				decodeClient({
					...request,
					idempotencyKey: "k".repeat(BACKGROUND_SUBMISSION_KEY_MAX_LENGTH),
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeClient({
					...request,
					idempotencyKey: "k".repeat(BACKGROUND_SUBMISSION_KEY_MAX_LENGTH + 1),
				}),
			),
		).toBe(true);
		expect(
			Result.isFailure(decodeClient({ ...request, contentHash: "plugin-controlled-hash" })),
		).toBe(true);
		expect(Result.isFailure(decodeClient({ ...request, action: { url: "https://x" } }))).toBe(true);
	});

	it("accepts only a local message as the label", () => {
		for (const label of ["Logged episode 3", { key: "Not a key" }]) {
			expect(Result.isFailure(decodeClient({ ...request, label }))).toBe(true);
		}
	});

	it("accepts a submission ID or a bridge failure on the acceptance reply", () => {
		const accepted = { requestId: "request-1", type: "background-operation-accepted" };
		expect(
			Result.isSuccess(decodeHost({ ...accepted, outcome: "success", submissionId: "s-1" })),
		).toBe(true);
		for (const reason of ["transport", "operation-failed", "malformed-result"]) {
			expect(Result.isSuccess(decodeHost({ ...accepted, reason, outcome: "failure" }))).toBe(true);
		}
		expect(
			Result.isFailure(decodeHost({ ...accepted, outcome: "failure", reason: "app-updated" })),
		).toBe(true);
		expect(Result.isFailure(decodeClient({ ...accepted, outcome: "success" }))).toBe(true);
	});

	it("settles with an outcome class that carries a message only for rejections", () => {
		const settled = { submissionId: "s-1", type: "background-operation-settled" };
		for (const outcome of [
			{ status: "succeeded" },
			{ status: "incomplete" },
			{ status: "failed", reason: "transport" },
			{ status: "failed", reason: "operation-failed" },
			{ status: "failed", reason: "malformed-result" },
			{ status: "failed", reason: "app-updated" },
			{ status: "failed", message: rejection, reason: "operation-rejected" },
		]) {
			expect(Result.isSuccess(decodeHost({ ...settled, outcome }))).toBe(true);
		}
		for (const outcome of [
			{ status: "pending" },
			{ status: "succeeded", value: { count: 1 } },
			{ status: "failed", reason: "operation-rejected" },
			{ status: "failed", message: "secret", reason: "transport" },
		]) {
			expect(Result.isFailure(decodeHost({ ...settled, outcome }))).toBe(true);
		}
		expect(Result.isFailure(decodeClient({ ...settled, outcome: { status: "succeeded" } }))).toBe(
			true,
		);
	});
});
