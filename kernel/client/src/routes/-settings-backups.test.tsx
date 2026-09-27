import { describe, expect, it } from "@effect/vitest";
import { BackupConflict } from "@ryot-app/contract/modules/backups/schemas";
import { BackupRunId } from "@ryot-app/contract/schema/brands";
import type { BackupRunItem } from "@ryot-app/ryotql-recipes/backups";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Effect, Layer, ManagedRuntime } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { BackupsApi } from "#/api/backups";
import {
	KernelApiTestLayer,
	makeBackupsApi,
	makeRyotQLApi,
	makeUploadsApi,
} from "#/api/ports.test-layer";
import type { RyotQLApi } from "#/api/ryotql";
import type { UploadsApi } from "#/api/uploads";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";
import { makePluginCatalogEventsTestLayer } from "#/modules/plugins/events.test-layer";
import {
	makePluginCatalog,
	makePluginOperations,
	makePluginQueries,
	makePluginStorage,
} from "#/modules/plugins/services.test-layer";
import { getRouter } from "#/router";
import {
	theme,
	catalog,
	authenticated,
	ServerStub,
	makeAuthStub,
	OAuthRouteStubs,
	makeStorageStubLayer,
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

const nowMs = Date.now();

const at = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();

const makeRun = (overrides: Partial<BackupRunItem> = {}): BackupRunItem => ({
	failure: null,
	progress: 100,
	kind: "export",
	status: "completed",
	createdAt: at(-HOUR_MS),
	artifactProvider: "local",
	expiresAt: at(23 * HOUR_MS),
	startedAt: at(-HOUR_MS + 2_000),
	id: BackupRunId.make("backup_1"),
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
		putBytes: () => Effect.void,
		completeIntent: () => Effect.succeed({ token: "upload_1", expiresAt: at(HOUR_MS) }),
		createIntent: () =>
			Effect.succeed({
				headers: {},
				intentId: "intent_1",
				method: "PUT" as const,
				expiresAt: at(HOUR_MS),
				uploadUrl: "/uploads/local/put",
			}),
	});

type RunsResponse = {
	readonly items: readonly BackupRunItem[];
	readonly hasMore?: boolean;
	readonly nextCursor?: string | null;
};
type RunsLoad = (after?: string) => Effect.Effect<RunsResponse, AuthenticatedApiError>;

const makeBackupQueries = (load: RunsLoad): Layer.Layer<RyotQLApi> =>
	makeRyotQLApi({
		execute: (_scope, request) => {
			const runs = request.payload.queries.runs;
			if (runs.output.type !== "rows") {
				return Effect.die("Expected backup runs rows query");
			}
			const { limit, after } = runs.output.pagination;
			return Effect.map(load(after), (page) => ({
				data: {
					runs: {
						items: page.items,
						type: "rows" as const,
						pageInfo: {
							limit,
							hasMore: page.hasMore ?? false,
							nextCursor: page.nextCursor ?? null,
						},
					},
				},
			}));
		},
	});

const emptyRuns: RunsLoad = () => Effect.succeed({ items: [] });

const mountView = (
	initialEntry: string,
	backupsApi: Layer.Layer<BackupsApi> = makeBackupsApi(),
	uploadsApi: Layer.Layer<UploadsApi> = makeUploadsApi(),
	auth = makeAuthStub(),
	load: RunsLoad = emptyRuns,
) => {
	const events = makePluginCatalogEventsTestLayer();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProviderAddRouteStubs,
			ImportsRouteStubs,
			IntegrationRouteStubs,
			NotificationChannelRouteStubs,
			NotificationChannelRouteStubs,
			auth,
			GodModeRouteStubs,
			ServerStub,
			SavedViewRouteStubs,
			EntityRouteStubs,
			makePublicApiStub(),
			KernelApiTestLayer,
			makeBackupQueries(load),
			ClientPagesApiRouteStubs,
			ClientPageSessionsRouteStubs,
			makeUserSettingsStub(),
			events.layer,
			makePluginCatalog(catalog),
			NavigationRouteStubs,
			CustomizeRouteStubs,
			makePluginOperations(),
			makePluginQueries(),
			makePluginStorage(),
			uploadsApi,
			backupsApi,
		).pipe(
			Layer.provideMerge(OAuthRouteStubs),
			Layer.provideMerge(makeStorageStubLayer("fixture")),
		),
	);
	const router = getRouter(
		{ theme, runtime, backInterceptors: createBackInterceptors() },
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
	const view = render(<RouterProvider router={router} />);
	return { ...view, router };
};

const attachArchive = () => {
	fireEvent.click(screen.getByRole("button", { name: "Choose a file for Backup archive" }));
	return Effect.runPromise(
		Effect.gen(function* () {
			const input = yield* Effect.promise(() =>
				waitFor(() => {
					const found = document.querySelector('input[type="file"]');
					if (!(found instanceof HTMLInputElement)) {
						throw new Error("the file chooser was never mounted");
					}
					return found;
				}),
			);
			fireEvent.change(input, { target: { files: fileListOf(zipArchive()) } });
			yield* Effect.promise(() => screen.findByText("4 B · Ready to restore"));
		}),
	);
};

it.live("loads older backups by cursor without discarding recent runs", () =>
	Effect.gen(function* () {
		const cursors: Array<string | undefined> = [];
		mountView("/settings/backups", makeBackupsApi(), makeUploadsApi(), makeAuthStub(), (after) => {
			cursors.push(after);
			return Effect.succeed(
				after === undefined
					? { hasMore: true, items: [makeRun()], nextCursor: "older-cursor" }
					: { items: [makeRun({ kind: "restore", id: BackupRunId.make("backup_2") })] },
			);
		});

		yield* Effect.promise(() => screen.findByText("Ready to download"));
		fireEvent.click(screen.getByRole("button", { name: "Load more backups" }));
		yield* Effect.promise(() => screen.findByText("Restored"));
		expect(screen.getByText("Ready to download")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Load more backups" })).toBeNull();
		expect(cursors).toEqual([undefined, "older-cursor"]);
	}),
);

it.live("retries a failed cursor page while retaining earlier backups", () =>
	Effect.gen(function* () {
		let olderAttempts = 0;
		mountView("/settings/backups", makeBackupsApi(), makeUploadsApi(), makeAuthStub(), (after) => {
			if (after === undefined) {
				return Effect.succeed({ hasMore: true, items: [makeRun()], nextCursor: "older" });
			}
			olderAttempts += 1;
			return olderAttempts === 1
				? Effect.fail(new AuthenticatedApiError({ cause: 500 }))
				: Effect.succeed({
						items: [makeRun({ kind: "restore", id: BackupRunId.make("backup_2") })],
					});
		});

		fireEvent.click(
			yield* Effect.promise(() => screen.findByRole("button", { name: "Load more backups" })),
		);
		yield* Effect.promise(() => screen.findByText("Could not load more backups. Try again."));
		expect(screen.getByText("Ready to download")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Load more backups" }));
		yield* Effect.promise(() => screen.findByText("Restored"));
		expect(olderAttempts).toBe(2);
	}),
);

describe("backups list", () => {
	it.live("renders the protected demo state without starting the backup query", () =>
		Effect.gen(function* () {
			let loads = 0;
			mountView(
				"/settings/backups",
				makeBackupsApi({}),
				makeUploadsApi(),
				makeAuthStub({}, { ...authenticated, accessClass: "demo" }),
				() => {
					loads += 1;
					return Effect.succeed({ items: [] });
				},
			);

			yield* Effect.promise(() => screen.findByText("Backups are unavailable"));
			expect(
				screen.getByText("This operation is unavailable while using the shared demo account."),
			).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Create a backup" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Restore from a backup" })).toBeNull();
			expect(loads).toBe(0);
		}),
	);

	it.live("shows the ordinary pending state while the query is unresolved", () =>
		Effect.gen(function* () {
			let complete!: (value: { readonly items: readonly BackupRunItem[] }) => void;
			mountView("/settings/backups", makeBackupsApi({}), makeUploadsApi(), makeAuthStub(), () =>
				// oxlint-disable-next-line effecttsgo/new-promise -- This controllable test gate stays pending until the host callback or test releases it.
				Effect.promise(() => new Promise((resolve) => (complete = resolve))),
			);

			yield* Effect.promise(() => screen.findByText("Loading your backups..."));
			complete({ items: [] });
			yield* Effect.promise(() => screen.findByText("No backups yet"));
		}),
	);

	it.live("names each run by its kind and shows what it can still do", () =>
		Effect.gen(function* () {
			mountView("/settings/backups", makeBackupsApi({}), makeUploadsApi(), makeAuthStub(), () =>
				Effect.succeed({
					items: [
						makeRun(),
						makeRun({ kind: "restore", expiresAt: null, id: BackupRunId.make("backup_2") }),
					],
				}),
			);

			yield* Effect.promise(() => screen.findByText("Ready to download"));
			expect(screen.getByText("Expires in 23 hours")).toBeTruthy();
			expect(screen.getByText("Restored")).toBeTruthy();
			expect(screen.getAllByText("Backup")).toHaveLength(1);
			expect(screen.getAllByText("Restore")).toHaveLength(1);
			expect(
				screen.getByRole("button", { name: "Delete the restore record from 1 hour ago" }),
			).toBeTruthy();
		}),
	);

	it.live("offers a backup from the empty state", () =>
		Effect.gen(function* () {
			mountView("/settings/backups", makeBackupsApi({}), makeUploadsApi(), makeAuthStub(), () =>
				Effect.succeed({ items: [] }),
			);

			yield* Effect.promise(() => screen.findByText("No backups yet"));
			expect(screen.getAllByRole("button", { name: "Create a backup" })).toHaveLength(1);
			expect(
				screen.getByRole("button", { name: "Restore from a backup" }).hasAttribute("disabled"),
			).toBe(false);
		}),
	);

	it.live("retries a history query that could not be loaded", () =>
		Effect.gen(function* () {
			let loads = 0;
			let retry = false;
			mountView("/settings/backups", makeBackupsApi({}), makeUploadsApi(), makeAuthStub(), () => {
				loads += 1;
				return !retry
					? Effect.fail(new AuthenticatedApiError({ cause: 500 }))
					: Effect.succeed({ items: [] });
			});

			yield* Effect.promise(() => screen.findByText("Unable to load backups"));
			retry = true;
			fireEvent.click(screen.getByRole("button", { name: "Try again" }));
			yield* Effect.promise(() => screen.findByText("No backups yet"));
			expect(loads).toBeGreaterThan(1);
		}),
	);

	it.live("shows the progress of a run that is still going and blocks another", () =>
		Effect.gen(function* () {
			mountView("/settings/backups", makeBackupsApi({}), makeUploadsApi(), makeAuthStub(), () =>
				Effect.succeed({ items: [makeRun({ progress: 25, finishedAt: null, status: "running" })] }),
			);

			yield* Effect.promise(() => screen.findByText("Running"));
			const bar = screen.getByRole("progressbar");
			expect(bar.getAttribute("aria-valuetext")).toBe("25% done");
			expect(screen.getByText("25%")).toBeTruthy();
			expect(screen.getByRole("button", { name: /Create a backup/ }).hasAttribute("disabled")).toBe(
				true,
			);
			expect(
				screen.getByRole("button", { name: "Restore from a backup" }).hasAttribute("disabled"),
			).toBe(true);
		}),
	);

	it.live("starts a backup and reloads the history", () =>
		Effect.gen(function* () {
			let loads = 0;
			let exports = 0;
			mountView(
				"/settings/backups",
				makeBackupsApi({
					createExport: () => {
						exports += 1;
						return Effect.succeed({ id: BackupRunId.make("backup_1") });
					},
				}),
				makeUploadsApi(),
				makeAuthStub(),
				() => {
					loads += 1;
					return Effect.succeed({
						items: loads === 1 ? [] : [makeRun({ progress: 0, status: "pending" })],
					});
				},
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Create a backup" })),
			);

			yield* Effect.promise(() => screen.findByText("Queued"));
			expect(exports).toBe(1);
			expect(loads).toBe(2);
			expect(screen.getByText("Preparing")).toBeTruthy();
		}),
	);

	it.live("keeps previous data visible when a mutation refresh fails", () =>
		Effect.gen(function* () {
			let loads = 0;
			mountView(
				"/settings/backups",
				makeBackupsApi({
					createExport: () => Effect.succeed({ id: BackupRunId.make("backup_2") }),
				}),
				makeUploadsApi(),
				makeAuthStub(),
				() => {
					loads += 1;
					return loads === 1
						? Effect.succeed({ items: [makeRun()] })
						: Effect.fail(new AuthenticatedApiError({ cause: 500 }));
				},
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: /Create a backup/ })),
			);

			yield* Effect.promise(() => waitFor(() => expect(loads).toBe(2)));
			expect(screen.getByText("Ready to download")).toBeTruthy();
			expect(screen.queryByText("Unable to load backups")).toBeNull();
		}),
	);

	it.live("reports a backup that could not be started", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/backups",
				makeBackupsApi({
					createExport: () => Effect.fail(conflict({ code: "active-run-exists" })),
				}),
				makeUploadsApi(),
				makeAuthStub(),
				() => Effect.succeed({ items: [makeRun()] }),
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: /Create a backup/ })),
			);

			yield* Effect.promise(() =>
				screen.findByText("This backup could not be started. Try again."),
			);
		}),
	);
});

describe("backup records", () => {
	it.live("deletes a record after confirming and reloads the history", () =>
		Effect.gen(function* () {
			const deleted: string[] = [];
			let loads = 0;
			mountView(
				"/settings/backups",
				makeBackupsApi({
					deleteRun: (_scope, request) => {
						deleted.push(request.params.id);
						return Effect.succeed({ id: request.params.id });
					},
				}),
				makeUploadsApi(),
				makeAuthStub(),
				() => {
					loads += 1;
					return Effect.succeed({ items: loads === 1 ? [makeRun()] : [] });
				},
			);

			fireEvent.click(
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Delete the backup record from 1 hour ago" }),
				),
			);
			const dialog = yield* Effect.promise(() => screen.findByRole("dialog"));
			expect(dialog.textContent).toContain("any copy you already downloaded is untouched");
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete record" }));

			yield* Effect.promise(() => screen.findByText("No backups yet"));
			expect(deleted).toEqual(["backup_1"]);
			expect(loads).toBe(2);
		}),
	);

	it.live("keeps the confirmation open when the delete fails", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/backups",
				makeBackupsApi({ deleteRun: () => Effect.fail(conflict({ code: "run-still-active" })) }),
				makeUploadsApi(),
				makeAuthStub(),
				() => Effect.succeed({ items: [makeRun()] }),
			);

			fireEvent.click(
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Delete the backup record from 1 hour ago" }),
				),
			);
			const dialog = yield* Effect.promise(() => screen.findByRole("dialog"));
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete record" }));

			yield* Effect.promise(() =>
				screen.findByText("This record could not be deleted. Try again."),
			);
			expect(screen.getByRole("dialog")).toBeTruthy();
		}),
	);
});

describe("backup downloads", () => {
	it.live("starts an archive download after the API returns a URL", () =>
		Effect.gen(function* () {
			const downloads: string[] = [];
			mountView(
				"/settings/backups",
				makeBackupsApi({
					downloadArchive: (_scope, runId) => {
						downloads.push(runId);
						return Effect.void;
					},
				}),
				makeUploadsApi(),
				makeAuthStub(),
				() => Effect.succeed({ items: [makeRun()] }),
			);

			fireEvent.click(
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Download the backup from 1 hour ago" }),
				),
			);

			yield* Effect.promise(() => waitFor(() => expect(downloads).toEqual(["backup_1"])));
		}),
	);

	it.live("reports an archive that could not be downloaded", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/backups",
				makeBackupsApi({
					downloadArchive: () => Effect.fail(new AuthenticatedApiError({ cause: 404 })),
				}),
				makeUploadsApi(),
				makeAuthStub(),
				() => Effect.succeed({ items: [makeRun()] }),
			);

			fireEvent.click(
				yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Download the backup from 1 hour ago" }),
				),
			);

			yield* Effect.promise(() => screen.findByText("Could not download this backup. Try again."));
		}),
	);
});

describe("backup restore", () => {
	it.live("keeps the wizard in the URL so closing it returns to the history", () =>
		Effect.gen(function* () {
			const view = mountView(
				"/settings/backups",
				makeBackupsApi({}),
				makeUploadsApi(),
				makeAuthStub(),
				() => Effect.succeed({ items: [makeRun()] }),
			);

			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Restore from a backup" })),
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.search.restore).toBe(true)),
			);
			const wizard = yield* Effect.promise(() => screen.findByRole("dialog"));
			expect(wizard.textContent).toContain("Step 1 of 2 · Choose your backup file");

			fireEvent.click(within(wizard).getByRole("button", { name: "Close the restore wizard" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.router.state.location.search.restore).toBeUndefined()),
			);
			expect(screen.queryByRole("dialog")).toBeNull();
		}),
	);

	it.live("starts a restore from the uploaded archive", () =>
		Effect.gen(function* () {
			const tokens: string[] = [];
			let loads = 0;
			mountView(
				"/settings/backups?restore=true",
				makeBackupsApi({
					createRestore: (_scope, request) => {
						tokens.push(request.payload.uploadToken);
						return Effect.succeed({ id: BackupRunId.make("backup_2") });
					},
				}),
				uploadStub(),
				makeAuthStub(),
				() => {
					loads += 1;
					return Effect.succeed({
						items:
							loads === 1
								? [makeRun()]
								: [makeRun({ progress: 10, kind: "restore", status: "running" })],
					});
				},
			);

			yield* Effect.promise(() => screen.findByRole("dialog"));
			yield* Effect.promise(() => attachArchive());
			fireEvent.click(screen.getByRole("button", { name: "Continue to confirm the restore" }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Restore this backup" })),
			);

			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
			expect(tokens).toEqual(["upload_1"]);
			yield* Effect.promise(() => screen.findByText("Running"));
			expect(loads).toBe(2);
		}),
	);

	it.live("explains an account that is not empty on the confirm step", () =>
		Effect.gen(function* () {
			mountView(
				"/settings/backups?restore=true",
				makeBackupsApi({
					createRestore: () =>
						Effect.fail(conflict({ category: "entities", code: "account-not-clean" })),
				}),
				uploadStub(),
				makeAuthStub(),
				() => Effect.succeed({ items: [makeRun()] }),
			);

			yield* Effect.promise(() => screen.findByRole("dialog"));
			yield* Effect.promise(() => attachArchive());
			fireEvent.click(screen.getByRole("button", { name: "Continue to confirm the restore" }));
			fireEvent.click(
				yield* Effect.promise(() => screen.findByRole("button", { name: "Restore this backup" })),
			);

			yield* Effect.promise(() =>
				screen.findByText(
					"This account already has data in it. A backup can only be restored into a new, empty account.",
				),
			);
			expect(screen.getByRole("dialog").textContent).toContain("Step 2 of 2 · Confirm the restore");
		}),
	);
});
