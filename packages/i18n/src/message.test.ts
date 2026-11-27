import { describe, expect, it } from "bun:test";

import { Result, Schema } from "effect";

import {
	LocalMessage,
	MAX_MESSAGE_ARGUMENTS,
	MAX_MESSAGE_NESTING_DEPTH,
	Message,
	stampNamespace,
	stampTrustedNamespace,
	TrustedLocalMessage,
} from "./message";

const decodeMessage = Schema.decodeUnknownResult(Message);

const nest = (levels: number, leaf: object, wrap: (inner: object) => object) => {
	let value = leaf;
	for (let level = 0; level < levels; level += 1) {
		value = wrap(value);
	}
	return value;
};

const nestedMessage = (inner: object) => ({
	params: { inner },
	key: "item.nested",
	namespace: "kernel",
});

const nestedLocal = (inner: object) => ({ params: { inner }, key: "item.nested" });

const numberParams = (count: number) =>
	Object.fromEntries(Array.from({ length: count }, (_, index) => [`p${index}`, index]));

describe("message model", () => {
	it("accepts JSON-safe parameters and nested messages", () => {
		const message = {
			namespace: "media",
			key: "notification.release",
			params: {
				count: 2,
				title: "Dune",
				at: { date: "2026-11-15T10:00:00.000Z" },
				reason: { namespace: "kernel", key: "release.reason" },
			},
		};
		expect(Result.getOrThrow(decodeMessage(message))).toEqual(message);
	});

	it("rejects computed keys, non-finite numbers and unparseable dates", () => {
		for (const message of [
			{ namespace: "kernel", key: "Error.NotFound" },
			{ key: "single", namespace: "kernel" },
			{ key: "error.not-found", namespace: "kernel plugin" },
			{ key: "error.count", namespace: "kernel", params: { count: Number.NaN } },
			{
				key: "error.at",
				namespace: "kernel",
				params: { at: { date: "2026-13-45T00:00:00.000Z" } },
			},
			{ key: "error.at", namespace: "kernel", params: { "0": "positional" } },
		]) {
			expect(Result.isFailure(decodeMessage(message))).toBe(true);
		}
	});

	it("rejects messages nested past the render depth and too many parameters", () => {
		const leaf = { key: "item.leaf", namespace: "kernel" };
		expect(
			Result.isSuccess(decodeMessage(nest(MAX_MESSAGE_NESTING_DEPTH, leaf, nestedMessage))),
		).toBe(true);
		expect(
			Result.isFailure(decodeMessage(nest(MAX_MESSAGE_NESTING_DEPTH + 1, leaf, nestedMessage))),
		).toBe(true);
		const decodeLocal = Schema.decodeUnknownResult(LocalMessage);
		expect(
			Result.isSuccess(
				decodeLocal(nest(MAX_MESSAGE_NESTING_DEPTH, { key: "item.leaf" }, nestedLocal)),
			),
		).toBe(true);
		expect(
			Result.isFailure(
				decodeLocal(nest(MAX_MESSAGE_NESTING_DEPTH + 1, { key: "item.leaf" }, nestedLocal)),
			),
		).toBe(true);
		expect(
			Result.isSuccess(decodeMessage({ ...leaf, params: numberParams(MAX_MESSAGE_ARGUMENTS) })),
		).toBe(true);
		expect(
			Result.isFailure(decodeMessage({ ...leaf, params: numberParams(MAX_MESSAGE_ARGUMENTS + 1) })),
		).toBe(true);
	});

	it("stamps the namespace onto local messages and their nested local messages", () => {
		const local = Result.getOrThrow(
			Schema.decodeResult(LocalMessage)({
				key: "rejection.duplicate",
				params: { field: { key: "field.title" }, at: { date: "2026-11-15T10:00:00.000Z" } },
			}),
		);
		expect(stampNamespace("fitness", local)).toEqual({
			namespace: "fitness",
			key: "rejection.duplicate",
			params: {
				at: { date: "2026-11-15T10:00:00.000Z" },
				field: { key: "field.title", namespace: "fitness" },
			},
		});
	});

	it("keeps already stamped nested messages only on the trusted path", () => {
		const input = {
			key: "notification.disabled",
			params: {
				detail: { key: "detail.reason" },
				provider: { namespace: "media", key: "provider.name" },
			},
		};
		const trusted = Result.getOrThrow(Schema.decodeResult(TrustedLocalMessage)(input));
		expect(stampTrustedNamespace("kernel", trusted)).toEqual({
			namespace: "kernel",
			key: "notification.disabled",
			params: {
				detail: { namespace: "kernel", key: "detail.reason" },
				provider: { namespace: "media", key: "provider.name" },
			},
		});
		const local = Result.getOrThrow(Schema.decodeResult(LocalMessage)(input));
		expect(stampNamespace("fitness", local).params?.["provider"]).toEqual({
			key: "provider.name",
			namespace: "fitness",
		});
	});
});
