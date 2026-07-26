import type { ListedImportSource } from "@ryot/contract/modules/imports/schemas";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { decodeImportRunDetail, decodeImportRunList } from "./import-fixture";
import {
	importRunDetailError,
	importRunListError,
	mapImportRunDetail,
	mapImportRunList,
	mapImportSourceNames,
} from "./state";

const listedSource = (slug: string, name: string): Pick<ListedImportSource, "slug" | "name"> => ({
	name,
	slug,
});

describe("import run state", () => {
	it("separates a waiting query from an empty history", () => {
		expect(mapImportRunList(AsyncResult.initial(true))).toEqual({ status: "loading" });
		expect(mapImportRunList(AsyncResult.success(decodeImportRunList({ runs: [] })))).toEqual({
			status: "empty",
		});
	});

	it("carries the loaded runs and whether older ones remain", () => {
		const state = mapImportRunList(AsyncResult.success(decodeImportRunList({ hasMore: true })));

		expect(state.status).toBe("ready");
		expect(state.status === "ready" && state.hasMore).toBe(true);
		expect(state.status === "ready" && state.runs.map((run) => run.id)).toEqual([
			"run-completed-1",
		]);
	});

	it("tells a missing run apart from a failing query", () => {
		expect(mapImportRunDetail(AsyncResult.success(decodeImportRunDetail({ run: null })))).toEqual({
			status: "not-found",
		});
		expect(mapImportRunDetail(AsyncResult.failure(Cause.fail(new Error("offline")))).status).toBe(
			"transport-error",
		);
		expect(
			mapImportRunDetail(AsyncResult.failure(Cause.fail(new RyotQLMalformedResultError("bad row"))))
				.status,
		).toBe("malformed");
	});

	it("carries the run with its loaded failures", () => {
		const state = mapImportRunDetail(AsyncResult.success(decodeImportRunDetail()));

		expect(state.status === "ready" && state.run.id).toBe("run-completed-1");
		expect(state.status === "ready" && state.failures.length).toBe(2);
		expect(state.status === "ready" && state.hasMoreFailures).toBe(false);
	});

	it("indexes source names and stays empty until they arrive", () => {
		expect(
			mapImportSourceNames(AsyncResult.success([listedSource("open_scale", "OpenScale")])).get(
				"open_scale",
			),
		).toBe("OpenScale");
		expect(mapImportSourceNames(AsyncResult.initial(true)).size).toBe(0);
	});

	it("never leaks transport or decoder detail into the message a reader sees", () => {
		const transport = importRunListError({ status: "transport-error" });
		const malformed = importRunDetailError({ status: "malformed" });

		expect(transport.title).toBe("Unable to load imports");
		expect(transport.detail).not.toContain("RyotQL");
		expect(malformed.title).toBe("Unable to load this import");
		expect(malformed.detail).not.toContain("decode");
	});
});
