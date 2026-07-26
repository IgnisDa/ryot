import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { backupRun, backupRunList } from "./backup-fixture";
import { backupRunListError, mapBackupRunList } from "./state";

describe("backup run state", () => {
	it("separates a waiting query from an account with no backups", () => {
		expect(mapBackupRunList(AsyncResult.initial(true))).toEqual({ status: "loading" });
		expect(mapBackupRunList(AsyncResult.success(backupRunList([])))).toEqual({ status: "empty" });
	});

	it("carries the loaded runs in the order the server returned them", () => {
		const state = mapBackupRunList(
			AsyncResult.success(
				backupRunList([backupRun(), backupRun({ id: "backup-run-2", kind: "restore" })]),
			),
		);

		expect(state.status).toBe("ready");
		expect(state.status === "ready" && state.runs.map((run) => run.id)).toEqual([
			"backup-run-1",
			"backup-run-2",
		]);
	});

	it("tells an unreachable server apart from an undisplayable answer", () => {
		expect(mapBackupRunList(AsyncResult.failure(Cause.fail(new Error("offline")))).status).toBe(
			"transport-error",
		);
		expect(
			mapBackupRunList(AsyncResult.failure(Cause.fail(new RyotQLMalformedResultError("bad row"))))
				.status,
		).toBe("malformed");
	});

	it("names the backups list in both load failure messages", () => {
		expect(backupRunListError({ status: "transport-error" })).toEqual({
			title: "Unable to load backups",
			detail: "Your backups could not be loaded. Check the server and try again.",
		});
		expect(backupRunListError({ status: "malformed" }).detail).toBe(
			"Your backups came back in a form that could not be displayed. Try again later.",
		);
	});
});
