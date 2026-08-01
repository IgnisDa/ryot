import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";

import { RyotQLMalformedResultError } from "@/api/ryotql";

import { backupRun, backupRunList, NOW_MS } from "../backup-fixture";
import { mapBackupRunList, type BackupRunListState } from "./state";
import { BackupsView } from "./view";

const downloadableRun = backupRun();

const olderRun = backupRun({
	id: "backup-run-2",
	createdAt: "2026-03-13T09:00:00.000Z",
	startedAt: "2026-03-13T09:00:02.000Z",
	expiresAt: "2026-03-14T09:00:00.000Z",
	finishedAt: "2026-03-13T09:01:40.000Z",
});

const expiredRun = backupRun({
	id: "backup-run-expired",
	createdAt: "2026-03-11T11:00:00.000Z",
	startedAt: "2026-03-11T11:00:02.000Z",
	expiresAt: "2026-03-12T11:00:00.000Z",
	finishedAt: "2026-03-11T11:01:40.000Z",
});

const liveRun = backupRun({
	progress: 40,
	expiresAt: null,
	finishedAt: null,
	status: "running",
	id: "backup-run-live",
	startedAt: "2026-03-13T11:00:00.000Z",
});

const pendingRun = backupRun({
	expiresAt: null,
	startedAt: null,
	finishedAt: null,
	kind: "restore",
	status: "pending",
	id: "backup-run-pending",
});

const failedRun = backupRun({
	progress: 30,
	expiresAt: null,
	status: "failed",
	id: "backup-run-failed",
	failure: { code: "archive-invalid", issue: "checksum-mismatch" },
});

const readyState = (runs = [downloadableRun]) =>
	mapBackupRunList(AsyncResult.success(backupRunList(runs)));

const renderView = (
	state: BackupRunListState,
	overrides: {
		readonly isCreating?: boolean;
		readonly onRetry?: () => void;
		readonly downloadingRunId?: string;
		readonly onOpenRestore?: () => void;
		readonly onCreateExport?: () => void;
		readonly createFailureDetail?: string;
		readonly downloadFailureDetail?: string;
		readonly onDownload?: (run: { readonly id: string }) => void;
		readonly onRequestDelete?: (run: { readonly id: string }) => void;
	} = {},
) =>
	render(
		<BackupsView
			state={state}
			nowMs={NOW_MS}
			isCreating={overrides.isCreating ?? false}
			downloadingRunId={overrides.downloadingRunId}
			onRetry={overrides.onRetry ?? (() => undefined)}
			createFailureDetail={overrides.createFailureDetail}
			onDownload={overrides.onDownload ?? (() => undefined)}
			downloadFailureDetail={overrides.downloadFailureDetail}
			onOpenRestore={overrides.onOpenRestore ?? (() => undefined)}
			onCreateExport={overrides.onCreateExport ?? (() => undefined)}
			onRequestDelete={overrides.onRequestDelete ?? (() => undefined)}
		/>,
	);

describe("backups screen", () => {
	it("waits without claiming the account has no backups", async () => {
		await renderView(mapBackupRunList(AsyncResult.initial(true)));

		expect(screen.getByText("Loading your backups...")).toBeOnTheScreen();
		expect(screen.queryByText("No backups yet")).not.toBeOnTheScreen();
	});

	it("offers a retry when the list cannot be loaded", async () => {
		const user = userEvent.setup();
		const retries: number[] = [];
		await renderView(mapBackupRunList(AsyncResult.failure(Cause.fail(new Error("offline")))), {
			onRetry: () => retries.push(1),
		});

		await user.press(screen.getByRole("button", { name: "Try again" }));

		expect(screen.getByText("Unable to load backups")).toBeOnTheScreen();
		expect(
			screen.getByText("Your backups could not be loaded. Check the server and try again."),
		).toBeOnTheScreen();
		expect(retries).toEqual([1]);
	});

	it("hides decoder internals when the answer cannot be displayed", async () => {
		await renderView(
			mapBackupRunList(AsyncResult.failure(Cause.fail(new RyotQLMalformedResultError("bad row")))),
		);

		expect(screen.queryByText(/bad row/)).not.toBeOnTheScreen();
		expect(screen.getByRole("button", { name: "Try again" })).toBeOnTheScreen();
	});

	it("explains an untouched history and offers the one action that fills it", async () => {
		const user = userEvent.setup();
		const creates: number[] = [];
		await renderView(readyState([]), { onCreateExport: () => creates.push(1) });

		expect(screen.getByText("No backups yet")).toBeOnTheScreen();
		expect(screen.queryByText("Recent")).not.toBeOnTheScreen();

		await user.press(screen.getByRole("button", { name: "Create a backup" }));

		expect(creates).toEqual([1]);
	});

	it("lists the history and offers a download only while the archive is still there", async () => {
		const user = userEvent.setup();
		const downloaded: string[] = [];
		const restores: number[] = [];
		await renderView(readyState([downloadableRun, expiredRun]), {
			onOpenRestore: () => restores.push(1),
			onDownload: (run) => downloaded.push(run.id),
		});

		expect(screen.getByText("Recent")).toBeOnTheScreen();
		expect(screen.getByText("Ready to download")).toBeOnTheScreen();
		expect(screen.getByText("Expires in 23 hours")).toBeOnTheScreen();
		expect(screen.getByText("No longer available")).toBeOnTheScreen();
		expect(
			screen.queryByRole("button", { name: "Download the backup from 2 days ago" }),
		).not.toBeOnTheScreen();

		await user.press(screen.getByRole("button", { name: "Download the backup from 1 hour ago" }));
		await user.press(screen.getByRole("button", { name: "Restore from a backup" }));

		expect(downloaded).toEqual(["backup-run-1"]);
		expect(restores).toEqual([1]);
	});

	it("serializes archive downloads while one row is being prepared", async () => {
		await renderView(readyState([downloadableRun, olderRun]), {
			downloadingRunId: "backup-run-1",
		});

		expect(
			screen.getByRole("button", { name: "Download the backup from 1 hour ago" }),
		).toBeDisabled();
		expect(screen.getByText("Preparing...")).toBeOnTheScreen();
		expect(
			screen.getByRole("button", { name: "Download the backup from 3 hours ago" }),
		).toBeDisabled();
	});

	it("disables restore while an export creation request is pending", async () => {
		await renderView(readyState(), { isCreating: true });

		expect(screen.getByRole("button", { name: "Starting..." })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Restore from a backup" })).toBeDisabled();
	});

	async function expectExclusiveLiveRun(run: ReturnType<typeof backupRun>, kind: string) {
		await renderView(readyState([run]));

		expect(screen.getByRole("progressbar")).toBeOnTheScreen();
		expect(
			screen.getByText("This keeps running on your server, even if you close Ryot."),
		).toBeOnTheScreen();
		expect(
			screen.getByText(
				"A backup or restore is already under way. You can start another when it finishes.",
			),
		).toBeOnTheScreen();
		expect(screen.getByRole("button", { name: "Create a backup" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Restore from a backup" })).toBeDisabled();
		expect(screen.getAllByText(kind)).toHaveLength(1);
		expect(screen.queryByText("Recent")).not.toBeOnTheScreen();
		expect(
			screen.queryByRole("button", { name: /Delete the backup record/ }),
		).not.toBeOnTheScreen();
	}

	it("leads with a pending restore and refuses both create actions", async () => {
		await expectExclusiveLiveRun(pendingRun, "Restore");
	});

	it("leads with a running export and refuses both create actions", async () => {
		await expectExclusiveLiveRun(liveRun, "Backup");
	});

	it("keeps finished runs in history without repeating the live run", async () => {
		await renderView(readyState([liveRun, downloadableRun]));

		expect(screen.getAllByText("Backup")).toHaveLength(2);
		expect(screen.getByText("Recent")).toBeOnTheScreen();
		expect(screen.getByText("Ready to download")).toBeOnTheScreen();
	});

	it("explains a structured failed backup without server diagnostics", async () => {
		await renderView(readyState([failedRun]));

		expect(screen.getByText("Archive damaged")).toBeOnTheScreen();
		expect(
			screen.getByText(
				"This archive was damaged or incomplete, so nothing was changed. Download the backup again and retry.",
			),
		).toBeOnTheScreen();
		expect(screen.queryByText(/checksum/)).not.toBeOnTheScreen();
	});

	it("raises a failed start and a failed download next to the actions that caused them", async () => {
		await renderView(readyState(), {
			createFailureDetail: "This backup could not be started. Try again.",
			downloadFailureDetail: "This download link could not be prepared. Try again.",
		});

		const alerts = screen.getAllByRole("alert");

		expect(alerts[0]).toHaveTextContent("This backup could not be started. Try again.");
		expect(alerts[1]).toHaveTextContent("This download link could not be prepared. Try again.");
	});

	it("asks before removing a record rather than deleting on the spot", async () => {
		const user = userEvent.setup();
		const requested: string[] = [];
		await renderView(readyState([downloadableRun]), {
			onRequestDelete: (run) => requested.push(run.id),
		});

		await user.press(
			screen.getByRole("button", { name: "Delete the backup record from 1 hour ago" }),
		);

		expect(requested).toEqual(["backup-run-1"]);
	});
});
