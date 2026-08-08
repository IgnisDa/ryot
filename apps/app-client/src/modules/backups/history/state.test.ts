import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vitest";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { backupRun, backupRunList } from "../backup-fixture";
import { backupRunListError, mapBackupRunList, withBackupDownloadLock } from "./state";

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

	it("does not start or clear a concurrent backup download", async () => {
		const lock = { current: undefined as string | undefined };
		const starts: string[] = [];
		let finish: (() => void) | undefined;
		const first = withBackupDownloadLock(lock, "backup-run-1", () => {
			starts.push("first");
			return new Promise<void>((resolve) => {
				finish = resolve;
			});
		});
		const second = await withBackupDownloadLock(lock, "backup-run-2", () => {
			starts.push("second");
			return Promise.resolve();
		});

		expect(second).toBeUndefined();
		expect(lock.current).toBe("backup-run-1");
		expect(starts).toEqual(["first"]);

		finish?.();
		await first;
		expect(lock.current).toBeUndefined();
	});

	it("releases a backup download after it fails", async () => {
		const lock = { current: undefined as string | undefined };

		await expect(
			withBackupDownloadLock(lock, "backup-run-1", () => Promise.reject(new Error("failed"))),
		).rejects.toThrow("failed");
		expect(lock.current).toBeUndefined();
	});
});
