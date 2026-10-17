import { describe, expect, it } from "@effect/vitest";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Deferred, Effect } from "effect";

import { AdminApiError } from "#/api/admin";
import { FileDownloadError } from "#/modules/downloads/file";
import { ServerLogsView } from "#/modules/instance-admin/logs-view";
import type { InstanceAdminLogs } from "#/modules/instance-admin/service";

const activeFile = {
	size: 1_234,
	active: true,
	id: "active-log",
	name: "server.log",
	modifiedAt: "2026-09-30T12:00:00.000Z",
} satisfies InstanceAdminLogs["files"][number];

const compressedFile = {
	size: 5_678,
	active: false,
	id: "compressed-log",
	name: "server.log.1.gz",
	modifiedAt: "2026-09-29T12:00:00.000Z",
} satisfies InstanceAdminLogs["files"][number];

const logs = {
	files: [activeFile, compressedFile],
	pageInfo: { limit: 25, hasMore: false, nextCursor: null },
} satisfies InstanceAdminLogs;

describe("ServerLogsView", () => {
	for (const outcome of ["defect", "interruption", "throw"] as const) {
		it.live(`clears download busy state after ${outcome} and permits retry`, () =>
			Effect.gen(function* () {
				let requests = 0;
				render(
					<ServerLogsView
						unauthorized={() => undefined}
						load={() => Effect.succeed(logs)}
						download={() => {
							requests += 1;
							if (requests > 1) {
								return Effect.void;
							}
							if (outcome === "throw") {
								throw new Error("download construction failed");
							}
							return outcome === "defect" ? Effect.die("download defect") : Effect.interrupt;
						}}
					/>,
				);
				yield* Effect.promise(() => screen.findByText("server.log"));
				const download = screen.getByRole<HTMLButtonElement>("button", {
					name: "Download server.log",
				});
				fireEvent.click(download);
				yield* Effect.promise(() =>
					waitFor(() => {
						expect(requests).toBe(1);
						expect(download.disabled).toBe(false);
					}),
				);
				if (outcome === "interruption") {
					expect(screen.queryByRole("alert")).toBeNull();
				} else {
					expect(screen.getByRole("alert").textContent).toBe(
						"Could not download the logs. Check the server and try again.",
					);
				}
				fireEvent.click(download);
				yield* Effect.promise(() => waitFor(() => expect(requests).toBe(2)));
				expect(download.disabled).toBe(false);
				expect(screen.queryByRole("alert")).toBeNull();
			}),
		);
	}

	it.live("skips a repeated busy download without another request or error", () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			let requests = 0;
			render(
				<ServerLogsView
					unauthorized={() => undefined}
					load={() => Effect.succeed(logs)}
					download={() => {
						requests += 1;
						return Deferred.await(release);
					}}
				/>,
			);
			yield* Effect.promise(() => screen.findByText("server.log"));
			const download = screen.getByRole<HTMLButtonElement>("button", {
				name: "Download server.log",
			});
			act(() => {
				fireEvent.click(download);
				fireEvent.click(download);
			});
			yield* Effect.promise(() => screen.findByText("Downloading..."));
			expect(requests).toBe(1);
			expect(screen.queryByRole("alert")).toBeNull();
			yield* Deferred.succeed(release, undefined);
			yield* Effect.promise(() => waitFor(() => expect(download.disabled).toBe(false)));
			expect(requests).toBe(1);
			expect(screen.queryByRole("alert")).toBeNull();
		}),
	);

	it.live("interrupts a download on unmount and ignores its late unauthorized result", () =>
		Effect.gen(function* () {
			let settle: (() => void) | undefined;
			let interrupted = false;
			const calls: string[] = [];
			const view = render(
				<ServerLogsView
					load={() => Effect.succeed(logs)}
					unauthorized={() => {
						calls.push("unauthorized");
					}}
					download={() =>
						Effect.callback((resolve) => {
							settle = () =>
								resolve(
									Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
								);
							return Effect.sync(() => {
								interrupted = true;
							});
						})
					}
				/>,
			);
			yield* Effect.promise(() => screen.findByText("server.log"));
			fireEvent.click(screen.getByRole("button", { name: "Download server.log" }));
			yield* Effect.promise(() => waitFor(() => expect(settle).toBeDefined()));
			view.unmount();
			yield* Effect.promise(() => waitFor(() => expect(interrupted).toBe(true)));
			settle?.();
			yield* Effect.yieldNow;
			expect(calls).toEqual([]);
		}),
	);

	it.live("shows active and compressed log names and sizes", () =>
		Effect.gen(function* () {
			render(
				<ServerLogsView
					download={() => Effect.void}
					unauthorized={() => undefined}
					load={() => Effect.succeed(logs)}
				/>,
			);

			yield* Effect.promise(() => screen.findByText("server.log"));
			expect(screen.getByText("server.log.1.gz")).toBeTruthy();
			expect(screen.getByRole("table")).toBeTruthy();
			expect(screen.getByRole("columnheader", { name: "Log file" })).toBeTruthy();
			expect(screen.getByText("Active")).toBeTruthy();
			expect(screen.getByText("Compressed")).toBeTruthy();
			expect(screen.getByText("1,234 bytes")).toBeTruthy();
			expect(screen.getByText("5,678 bytes")).toBeTruthy();
		}),
	);

	it.live("loads and appends the next server-side page", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const requests: Array<{ readonly after: string | undefined; readonly limit: number }> = [];
			render(
				<ServerLogsView
					download={() => Effect.void}
					unauthorized={() => undefined}
					load={(after, limit) => {
						requests.push({ after, limit });
						return Effect.succeed(
							after === undefined
								? {
										files: [activeFile],
										pageInfo: { limit, hasMore: true, nextCursor: "cursor-1" },
									}
								: {
										files: [compressedFile],
										pageInfo: { limit, hasMore: false, nextCursor: null },
									},
						);
					}}
				/>,
			);

			yield* Effect.promise(() => screen.findByText("server.log"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Load more logs" })),
			);
			yield* Effect.promise(() => screen.findByText("server.log.1.gz"));

			expect(requests).toEqual([
				{ limit: 25, after: undefined },
				{ limit: 25, after: "cursor-1" },
			]);
			expect(screen.getByText("server.log")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Load more logs" })).toBeNull();
		}),
	);

	it.live("downloads one selected file or all files", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const downloaded: Array<InstanceAdminLogs["files"][number] | undefined> = [];
			render(
				<ServerLogsView
					unauthorized={() => undefined}
					load={() => Effect.succeed(logs)}
					download={(file) => {
						downloaded.push(file);
						return Effect.void;
					}}
				/>,
			);
			yield* Effect.promise(() => screen.findByText("server.log"));

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Download server.log" })),
			);
			yield* Effect.promise(() => waitFor(() => expect(downloaded).toHaveLength(1)));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.getByRole("button", { name: "Download all logs" }).hasAttribute("disabled"),
					).toBe(false),
				),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Download all logs" })),
			);
			yield* Effect.promise(() => waitFor(() => expect(downloaded).toHaveLength(2)));

			expect(downloaded).toEqual([logs.files[0], undefined]);
		}),
	);

	it.live("disables Download all when the list is empty", () =>
		Effect.gen(function* () {
			render(
				<ServerLogsView
					download={() => Effect.void}
					unauthorized={() => undefined}
					load={() =>
						Effect.succeed({ files: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } })
					}
				/>,
			);

			yield* Effect.promise(() => screen.findByText("No server logs available."));
			expect(
				screen.getByRole<HTMLButtonElement>("button", { name: "Download all logs" }).disabled,
			).toBe(true);
		}),
	);

	it.live("shows an initial load error and refresh retries", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			let attempts = 0;
			render(
				<ServerLogsView
					download={() => Effect.void}
					unauthorized={() => undefined}
					load={() => {
						attempts += 1;
						return attempts === 1
							? Effect.fail(new AdminApiError({ cause: "offline" }))
							: Effect.succeed(logs);
					}}
				/>,
			);

			const alert = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(alert.textContent).toContain("Could not load the server logs");
			yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Refresh" })));
			yield* Effect.promise(() => screen.findByText("server.log"));
			expect(attempts).toBe(2);
		}),
	);

	it.live("disables download buttons while a download is pending and re-enables them after", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const release = yield* Deferred.make<void>();
			render(
				<ServerLogsView
					unauthorized={() => undefined}
					load={() => Effect.succeed(logs)}
					download={() => Deferred.await(release)}
				/>,
			);
			yield* Effect.promise(() => screen.findByText("server.log"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Download server.log" })),
			);
			yield* Effect.promise(() => screen.findByText("Downloading..."));

			const refresh = screen.getByRole<HTMLButtonElement>("button", { name: "Refresh" });
			const downloadAll = screen.getByRole<HTMLButtonElement>("button", {
				name: "Download all logs",
			});
			const downloadFile = screen.getByRole<HTMLButtonElement>("button", {
				name: "Download server.log",
			});
			expect(refresh.disabled).toBe(true);
			expect(downloadAll.disabled).toBe(true);
			expect(downloadFile.disabled).toBe(true);

			yield* Deferred.succeed(release, undefined);
			yield* Effect.promise(() => waitFor(() => expect(refresh.disabled).toBe(false)));
			expect(downloadAll.disabled).toBe(false);
			expect(
				screen.getByRole<HTMLButtonElement>("button", { name: "Download server.log" }).disabled,
			).toBe(false);
		}),
	);

	it.live("calls the unauthorized handler when the initial load is unauthorized", () =>
		Effect.gen(function* () {
			const calls: Array<string> = [];
			render(
				<ServerLogsView
					download={() => Effect.void}
					unauthorized={() => calls.push("unauthorized")}
					load={() =>
						Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } }))
					}
				/>,
			);

			yield* Effect.promise(() => waitFor(() => expect(calls).toEqual(["unauthorized"])));
			expect(screen.queryByRole("alert")).toBeNull();
		}),
	);

	it.live("calls the unauthorized handler when a download is unauthorized", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const calls: Array<string> = [];
			render(
				<ServerLogsView
					load={() => Effect.succeed(logs)}
					unauthorized={() => calls.push("unauthorized")}
					download={() =>
						Effect.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } }))
					}
				/>,
			);
			yield* Effect.promise(() => screen.findByText("server.log"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Download server.log" })),
			);

			yield* Effect.promise(() => waitFor(() => expect(calls).toEqual(["unauthorized"])));
		}),
	);

	it.live("shows refresh guidance when the selected log is no longer available", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			render(
				<ServerLogsView
					unauthorized={() => undefined}
					load={() => Effect.succeed(logs)}
					download={() =>
						Effect.fail(
							new AdminApiError({
								cause: new FileDownloadError({ status: 404, cause: "missing" }),
							}),
						)
					}
				/>,
			);
			yield* Effect.promise(() => screen.findByText("server.log"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Download server.log" })),
			);

			const alert = yield* Effect.promise(() => screen.findByRole("alert"));
			expect(alert.textContent).toBe(
				"The log file is no longer available. Refresh the list and try again.",
			);
		}),
	);
});
