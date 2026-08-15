import { BackupConflict, type BackupRun } from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId } from "@ryot-app/contract/schema/brands";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { BackupsApi } from "#/api/backups";
import { KernelApiTestLayer, makeBackupsApi, makeUploadsApi } from "#/api/ports.test-layer";
import type { UploadsApi } from "#/api/uploads";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { ArtifactSessions } from "#/modules/plugins/artifact-sessions";
import { PluginCatalogService } from "#/modules/plugins/catalog";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import { PluginOperationsService } from "#/modules/plugins/operations";
import { PluginQueriesService } from "#/modules/plugins/queries";
import { ClientStorage } from "#/persistence/storage";
import { getRouter } from "#/router";
import {
	theme,
	catalog,
	ServerStub,
	makeAuthStub,
	OAuthRouteStubs,
	makeStorageStub,
	ImportsRouteStubs,
	GodModeRouteStubs,
	makePublicApiStub,
	CustomizeRouteStubs,
	SavedViewRouteStubs,
	EntityRouteStubs,
	NavigationRouteStubs,
	ProviderAddRouteStubs,
	IntegrationRouteStubs,
	NotificationChannelRouteStubs,
	makeUserSettingsStub,
	ClientPagesApiRouteStubs,
	ClientPageSessionsRouteStubs,
} from "#/routes/-route-fixtures";

const HOUR_MS = 3_600_000;

const AuthStub = makeAuthStub();

const nowMs = Date.now();

const at = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();

const makeRun = (overrides: Partial<BackupRun> = {}): BackupRun => ({
	failure: null,
	progress: 100,
	kind: "export",
	status: "completed",
	artifactProvider: "local",
	createdAt: at(-HOUR_MS),
	expiresAt: at(23 * HOUR_MS),
	id: BackupRunId.make("backup_1"),
	startedAt: at(-HOUR_MS + 2_000),
	finishedAt: at(-HOUR_MS + 100_000),
	...overrides,
});

const conflict = (reason: BackupConflict["reason"]) =>
	new AuthenticatedApiError({ cause: new BackupConflict({ reason }) });

const zipArchive = () =>
	new File([new Uint8Array([80, 75, 3, 4])], "ryot-backup.zip", { type: "application/zip" });

const fileListOf = (file: File) => ({
	0: file,
	length: 1,
	item: (index: number) => (index === 0 ? file : null),
});

const uploadStub = () =>
	makeUploadsApi({
		completeIntent: () => Effect.succeed({ token: "upload_1", expiresAt: at(HOUR_MS) }),
		createIntent: () =>
			Effect.succeed({
				headers: {},
				intentId: "intent_1",
				method: "PUT" as const,
				uploadUrl: "/uploads/local/put",
				expiresAt: at(HOUR_MS),
			}),
	});

const mountView = (
	initialEntry: string,
	backupsApi: Layer.Layer<BackupsApi> = makeBackupsApi(),
	uploadsApi: Layer.Layer<UploadsApi> = makeUploadsApi(),
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			NotificationChannelRouteStubs,
			AuthStub,
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			makeUserSettingsStub(),
			events.layer,
			Layer.succeed(ArtifactSessions, {
				renew: () => Effect.die("not used"),
				revoke: () => Effect.die("not used"),
				create: () => Effect.die("not used"),
			}),
			Layer.succeed(PluginCatalogService, { load: () => Effect.succeed(catalog) }),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			Layer.succeed(PluginOperationsService, { invoke: () => Effect.die("not used") }),
			Layer.succeed(PluginQueriesService, { query: () => Effect.die("not used") }),
			uploadsApi,
			backupsApi,
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(Layer.succeed(ClientStorage, makeStorageStub("fixture"))),
		),
	);
	const router = getRouter(
		{ runtime, theme, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router };
};

const savedDownloads: string[] = [];

const revokedUrls: string[] = [];

/**
 * jsdom implements neither object URLs nor a download, and the anchor the archive rides on is
 * created, clicked, and removed inside one synchronous call, so the saved name is only observable
 * from a capturing listener.
 */
URL.createObjectURL = () => "blob:ryot-archive";
URL.revokeObjectURL = (value: string) => void revokedUrls.push(value);

document.addEventListener(
	"click",
	(event) => {
		if (event.target instanceof HTMLAnchorElement) {
			savedDownloads.push(event.target.download);
			event.preventDefault();
		}
	},
	true,
);

const attachArchive = async () => {
	fireEvent.click(screen.getByRole("button", { name: "Choose a file for Backup archive" }));
	const input = await waitFor(() => {
		const found = document.querySelector('input[type="file"]');
		if (!(found instanceof HTMLInputElement)) {
			throw new Error("the file chooser was never mounted");
		}
		return found;
	});
	fireEvent.change(input, { target: { files: fileListOf(zipArchive()) } });
	await screen.findByText("4 B · Ready to restore");
};

const swappedFetch: { current: typeof globalThis.fetch | undefined } = { current: undefined };

/** The byte transfer is a bare `fetch` to a presigned URL, which jsdom has no server for. */
const stubUploadTransfer = () => {
	swappedFetch.current = globalThis.fetch;
	globalThis.fetch = () => Promise.resolve(new Response(null, { status: 200 }));
};

afterEach(() => {
	if (swappedFetch.current !== undefined) {
		globalThis.fetch = swappedFetch.current;
		swappedFetch.current = undefined;
	}
});

describe("backups list", () => {
	it("names each run by its kind and shows what it can still do", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({
				listRuns: () =>
					Effect.succeed({
						items: [
							makeRun(),
							makeRun({ kind: "restore", expiresAt: null, id: BackupRunId.make("backup_2") }),
						],
					}),
			}),
		);

		await screen.findByText("Ready to download");
		expect(screen.getByText("Expires in 23 hours")).toBeTruthy();
		expect(screen.getByText("Restored")).toBeTruthy();
		expect(screen.getAllByText("Backup")).toHaveLength(1);
		expect(screen.getAllByText("Restore")).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: "Delete the restore record from 1 hour ago" }),
		).toBeTruthy();
	});

	it("offers a backup from the empty state", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({ listRuns: () => Effect.succeed({ items: [] }) }),
		);

		await screen.findByText("No backups yet");
		expect(screen.getAllByRole("button", { name: "Create a backup" })).toHaveLength(1);
		expect(
			screen.getByRole("button", { name: "Restore from a backup" }).hasAttribute("disabled"),
		).toBe(false);
	});

	it("reports a history that could not be loaded", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({ listRuns: () => Effect.fail(new AuthenticatedApiError({ cause: 500 })) }),
		);

		await screen.findByText("Unable to load backups");
		expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
	});

	it("shows the progress of a run that is still going and blocks another", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({
				listRuns: () =>
					Effect.succeed({
						items: [makeRun({ progress: 25, status: "running", finishedAt: null })],
					}),
			}),
		);

		await screen.findByText("Running");
		const bar = screen.getByRole("progressbar");
		expect(bar.getAttribute("aria-valuetext")).toBe("25% done");
		expect(screen.getByText("25%")).toBeTruthy();
		expect(screen.getByRole("button", { name: /Create a backup/ }).hasAttribute("disabled")).toBe(
			true,
		);
		expect(
			screen.getByRole("button", { name: "Restore from a backup" }).hasAttribute("disabled"),
		).toBe(true);
	});

	it("starts a backup and reloads the history", async () => {
		let loads = 0;
		let exports = 0;
		mountView(
			"/settings/backups",
			makeBackupsApi({
				createExport: () => {
					exports += 1;
					return Effect.succeed({ id: BackupRunId.make("backup_1") });
				},
				listRuns: () => {
					loads += 1;
					return Effect.succeed({
						items: loads === 1 ? [] : [makeRun({ progress: 0, status: "pending" })],
					});
				},
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Create a backup" }));

		await screen.findByText("Queued");
		expect(exports).toBe(1);
		expect(screen.getByText("Preparing")).toBeTruthy();
	});

	it("reports a backup that could not be started", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({
				listRuns: () => Effect.succeed({ items: [makeRun()] }),
				createExport: () => Effect.fail(conflict({ code: "active-run-exists" })),
			}),
		);

		fireEvent.click(await screen.findByRole("button", { name: /Create a backup/ }));

		await screen.findByText("This backup could not be started. Try again.");
	});
});

describe("backup records", () => {
	it("deletes a record after confirming and reloads the history", async () => {
		const deleted: string[] = [];
		let loads = 0;
		mountView(
			"/settings/backups",
			makeBackupsApi({
				deleteRun: (_scope, request) => {
					deleted.push(request.params.id);
					return Effect.succeed({ id: request.params.id });
				},
				listRuns: () => {
					loads += 1;
					return Effect.succeed({ items: loads === 1 ? [makeRun()] : [] });
				},
			}),
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Delete the backup record from 1 hour ago" }),
		);
		const dialog = await screen.findByRole("dialog");
		expect(dialog.textContent).toContain("any copy you already downloaded is untouched");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete record" }));

		await screen.findByText("No backups yet");
		expect(deleted).toEqual(["backup_1"]);
	});

	it("keeps the confirmation open when the delete fails", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({
				listRuns: () => Effect.succeed({ items: [makeRun()] }),
				deleteRun: () => Effect.fail(conflict({ code: "run-still-active" })),
			}),
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Delete the backup record from 1 hour ago" }),
		);
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete record" }));

		await screen.findByText("This record could not be deleted. Try again.");
		expect(screen.getByRole("dialog")).toBeTruthy();
	});
});

describe("backup downloads", () => {
	it("hands the archive to the browser as a named file", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({
				listRuns: () => Effect.succeed({ items: [makeRun()] }),
				downloadArchive: () => Effect.succeed(new Blob([new Uint8Array([1, 2])])),
			}),
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Download the backup from 1 hour ago" }),
		);

		await waitFor(() => expect(savedDownloads).toEqual(["ryot-backup-backup_1.zip"]));
		expect(revokedUrls).toEqual(["blob:ryot-archive"]);
	});

	it("reports an archive that could not be downloaded", async () => {
		mountView(
			"/settings/backups",
			makeBackupsApi({
				listRuns: () => Effect.succeed({ items: [makeRun()] }),
				downloadArchive: () => Effect.fail(new AuthenticatedApiError({ cause: 404 })),
			}),
		);

		fireEvent.click(
			await screen.findByRole("button", { name: "Download the backup from 1 hour ago" }),
		);

		await screen.findByText("Could not download this backup. Try again.");
	});
});

describe("backup restore", () => {
	it("keeps the wizard in the URL so closing it returns to the history", async () => {
		const view = mountView(
			"/settings/backups",
			makeBackupsApi({ listRuns: () => Effect.succeed({ items: [makeRun()] }) }),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Restore from a backup" }));
		await waitFor(() => expect(view.router.state.location.search.restore).toBe(true));
		const wizard = await screen.findByRole("dialog");
		expect(wizard.textContent).toContain("Step 1 of 2 · Choose your backup file");

		fireEvent.click(within(wizard).getByRole("button", { name: "Close the restore wizard" }));
		await waitFor(() => expect(view.router.state.location.search.restore).toBeUndefined());
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("starts a restore from the uploaded archive", async () => {
		stubUploadTransfer();
		const tokens: string[] = [];
		let loads = 0;
		mountView(
			"/settings/backups?restore=true",
			makeBackupsApi({
				createRestore: (_scope, request) => {
					tokens.push(request.payload.uploadToken);
					return Effect.succeed({ id: BackupRunId.make("backup_2") });
				},
				listRuns: () => {
					loads += 1;
					return Effect.succeed({
						items:
							loads === 1
								? [makeRun()]
								: [makeRun({ kind: "restore", status: "running", progress: 10 })],
					});
				},
			}),
			uploadStub(),
		);

		await screen.findByRole("dialog");
		await attachArchive();
		fireEvent.click(screen.getByRole("button", { name: "Continue to confirm the restore" }));
		fireEvent.click(await screen.findByRole("button", { name: "Restore this backup" }));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(tokens).toEqual(["upload_1"]);
		await screen.findByText("Running");
	});

	it("explains an account that is not empty on the confirm step", async () => {
		stubUploadTransfer();
		mountView(
			"/settings/backups?restore=true",
			makeBackupsApi({
				listRuns: () => Effect.succeed({ items: [makeRun()] }),
				createRestore: () =>
					Effect.fail(conflict({ code: "account-not-clean", category: "entities" })),
			}),
			uploadStub(),
		);

		await screen.findByRole("dialog");
		await attachArchive();
		fireEvent.click(screen.getByRole("button", { name: "Continue to confirm the restore" }));
		fireEvent.click(await screen.findByRole("button", { name: "Restore this backup" }));

		await screen.findByText(
			"This account already has data in it. A backup can only be restored into a new, empty account.",
		);
		expect(screen.getByRole("dialog").textContent).toContain("Step 2 of 2 · Confirm the restore");
	});
});
