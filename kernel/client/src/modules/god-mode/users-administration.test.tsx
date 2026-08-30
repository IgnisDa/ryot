import { describe, expect, it } from "@effect/vitest";
import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { UserId } from "@ryot-app/contract/schema/brands";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect, Exit } from "effect";

import { AdminApiError } from "#/api/admin";
import type { ResetLinkTransfer } from "#/modules/god-mode/reset-link-transfer";
import type { GodModeUser } from "#/modules/god-mode/service";
import {
	type GodModeUserOperations,
	UsersAdministration,
} from "#/modules/god-mode/users-administration";
import { createBackInterceptors } from "#/modules/navigation/back-interceptors";

const makeUser = (index: number, authState: GodModeUser["authState"] = "credential") =>
	({
		authState,
		disabledAt: null,
		name: `Reader ${index}`,
		twoFactorEnabled: false,
		id: UserId.make(`user-${index}`),
		email: `reader-${index}@example.com`,
		createdAt: "2026-09-01T00:00:00.000Z",
	}) satisfies GodModeUser;

const makeOperations = (users: ReadonlyArray<GodModeUser>, calls: Array<unknown>) => {
	let currentUsers = [...users];
	return {
		resetUserPassword: () =>
			Promise.resolve(
				Exit.succeed({ email: "reader-0@example.com", resetUrl: "https://example.com/reset" }),
			),
		resetUser: () =>
			Promise.resolve(
				Exit.succeed({
					email: "reader-0@example.com",
					userId: UserId.make("user-0"),
					resetUrl: "https://example.com/reset-after-account-reset",
				}),
			),
		setUserDisabled: (userId, disabled) => {
			calls.push({ userId, disabled });
			currentUsers = currentUsers.map((user) =>
				user.id === userId
					? { ...user, disabledAt: disabled ? "2026-09-02T00:00:00.000Z" : null }
					: user,
			);
			return Promise.resolve(Exit.succeed({ id: UserId.make(userId) }));
		},
		deleteUser: (userId) => {
			currentUsers = currentUsers.filter((user) => user.id !== userId);
			return Promise.resolve(
				Exit.succeed({
					failure: null,
					startedAt: null,
					finishedAt: null,
					id: "operation-1",
					resetResult: null,
					kind: "delete" as const,
					userId: UserId.make(userId),
					status: "completed" as const,
					createdAt: "2026-09-01T00:00:00.000Z",
				}),
			);
		},
		listUsers: (search, after, limit) => {
			calls.push({ after, limit, search });
			const matching = currentUsers.filter((user) => user.email.includes(search));
			const offset = after === undefined ? 0 : Number(after);
			const items = matching.slice(offset, offset + limit);
			const nextCursor =
				offset + items.length < matching.length ? String(offset + items.length) : null;
			return Promise.resolve(
				Exit.succeed({
					items,
					total: matching.length,
					pageInfo: { limit, nextCursor, hasMore: nextCursor !== null },
				}),
			);
		},
	} satisfies GodModeUserOperations;
};

const renderUsers = (
	users: ReadonlyArray<GodModeUser>,
	transfer: ResetLinkTransfer = () => Promise.resolve("copied"),
	overrides: Partial<GodModeUserOperations> = {},
) => {
	const calls: Array<unknown> = [];
	const backInterceptors = createBackInterceptors();
	render(
		<UsersAdministration
			transferResetLink={transfer}
			backInterceptors={backInterceptors}
			onUnauthorized={() => calls.push("unauthorized")}
			operations={{ ...makeOperations(users, calls), ...overrides }}
		/>,
	);
	return { calls, backInterceptors };
};

describe("God Mode users administration", () => {
	it.live("loads 50-user pages, preserves loaded rows, and trims debounced searches", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const users = Array.from({ length: 51 }, (_, index) => makeUser(index));
			const view = renderUsers(users);

			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			expect(screen.getByText("Showing 50 of 51 users")).toBeTruthy();
			expect(screen.queryByText("reader-50@example.com")).toBeNull();
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Load more users" })),
			);
			yield* Effect.promise(() => screen.findByText("reader-50@example.com"));
			expect(view.calls).toContainEqual({ limit: 50, search: "", after: "50" });
			expect(screen.getByText("Showing 51 of 51 users")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Load more users" })).toBeNull();
			expect(screen.getByText("reader-0@example.com")).toBeTruthy();

			fireEvent.change(screen.getByRole("searchbox"), {
				target: { value: "  reader-50@example.com  " },
			});
			yield* Effect.promise(() =>
				waitFor(
					() =>
						expect(view.calls).toContainEqual({
							limit: 50,
							after: undefined,
							search: "reader-50@example.com",
						}),
					{ timeout: 700 },
				),
			);
			expect(yield* Effect.promise(() => screen.findByText("reader-50@example.com"))).toBeTruthy();
			expect(screen.queryByText("reader-0@example.com")).toBeNull();
		}),
	);

	it.live(
		"keeps the first cursor page visible when loading more fails and retries that cursor",
		() =>
			Effect.gen(function* () {
				const users = Array.from({ length: 51 }, (_, index) => makeUser(index));
				const list = makeOperations(users, []).listUsers;
				const requested: Array<string | undefined> = [];
				let failures = 0;
				renderUsers(users, undefined, {
					listUsers: (search, after, limit) => {
						requested.push(after);
						if (after === "50" && failures++ === 0) {
							return Promise.resolve(Exit.fail(new AdminApiError({ cause: "offline" })));
						}
						return list(search, after, limit);
					},
				});

				yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
				fireEvent.click(screen.getByRole("button", { name: "Load more users" }));
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Retry" })),
				);
				expect(screen.getByText("reader-0@example.com")).toBeTruthy();
				yield* Effect.promise(() => screen.findByText("reader-50@example.com"));
				expect(requested).toEqual([undefined, "50", "50"]);
			}),
	);

	it.live("shows the empty state when the first page has no users", () =>
		Effect.gen(function* () {
			renderUsers([]);
			yield* Effect.promise(() => screen.findByRole("heading", { name: "No users found" }));
			expect(screen.queryByRole("button", { name: "Load more users" })).toBeNull();
		}),
	);

	it.live("shows a reset-password result and injects reset-link transfer", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const transferred: string[] = [];
			renderUsers([makeUser(0)], (url) => {
				transferred.push(url);
				return Promise.resolve("copied");
			});
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" })),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Generate reset link" })),
			);
			const resetLink = yield* Effect.promise(() =>
				screen.findByLabelText<HTMLInputElement>("Password reset link"),
			);
			expect(resetLink.value).toBe("https://example.com/reset");
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Copy or share" })),
			);
			expect(transferred).toEqual(["https://example.com/reset"]);
			expect(screen.getByRole<HTMLButtonElement>("button", { name: "Copied!" }).disabled).toBe(
				true,
			);
		}),
	);

	it.live("opens and dismisses the accessible action menu", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const view = renderUsers([makeUser(0)]);
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			const trigger = screen.getByRole("button", { name: "Actions for reader-0@example.com" });
			expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
			expect(trigger.getAttribute("aria-expanded")).toBe("false");
			yield* Effect.promise(() => user.click(trigger));
			const menu = yield* Effect.promise(() => screen.findByRole("menu", { name: "User actions" }));
			const generate = within(menu).getByRole("menuitem", { name: "Generate reset link" });
			expect(trigger.getAttribute("aria-expanded")).toBe("true");
			expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
			expect(document.activeElement).toBe(generate);

			yield* Effect.promise(() => user.keyboard("{ArrowDown}"));
			expect(document.activeElement).toBe(
				within(menu).getByRole("menuitem", { name: "Disable user" }),
			);
			yield* Effect.promise(() => user.keyboard("{End}"));
			expect(document.activeElement).toBe(
				within(menu).getByRole("menuitem", { name: "Delete user" }),
			);
			yield* Effect.promise(() => user.keyboard("{Home}"));
			expect(document.activeElement).toBe(generate);

			fireEvent.keyDown(menu, { key: "Escape" });
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("menu")).toBeNull()));
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));

			yield* Effect.promise(() => user.click(trigger));
			yield* Effect.promise(() => user.click(document.body));
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("menu")).toBeNull()));

			yield* Effect.promise(() => user.click(trigger));
			expect(view.backInterceptors.run()).toBe(true);
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("menu")).toBeNull()));
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
		}),
	);

	it.live("restores focus to the action trigger after destructive confirmation", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const view = renderUsers([makeUser(0)]);
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			const trigger = screen.getByRole("button", { name: "Actions for reader-0@example.com" });

			yield* Effect.promise(() => user.click(trigger));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Reset account" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Reset this user?" }),
			);
			expect(screen.queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));

			yield* Effect.promise(() =>
				user.click(within(dialog).getByRole("button", { name: "Cancel" })),
			);
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));

			yield* Effect.promise(() => user.click(trigger));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Delete user" })),
			);
			const deleteDialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Delete this user?" }),
			);
			expect(view.backInterceptors.run()).toBe(true);
			yield* Effect.promise(() => waitFor(() => expect(deleteDialog.isConnected).toBe(false)));
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
		}),
	);

	it.live("contains dialog Tab focus and closes the confirmation on Escape", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			renderUsers([makeUser(0)]);
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" })),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Reset account" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Reset this user?" }),
			);
			const cancel = within(dialog).getByRole("button", { name: "Cancel" });
			const confirm = within(dialog).getByRole("button", { name: "Reset account" });
			expect(document.activeElement).toBe(cancel);

			fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
			expect(document.activeElement).toBe(confirm);
			fireEvent.keyDown(dialog, { key: "Tab" });
			expect(document.activeElement).toBe(cancel);

			fireEvent.keyDown(document, { key: "Escape" });
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()));
		}),
	);

	it.live("refuses every dismissal while the destructive operation is pending", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			let settle: (() => void) | undefined;
			const view = renderUsers([makeUser(0)], undefined, {
				deleteUser: () =>
					// oxlint-disable-next-line effecttsgo/new-promise -- This controllable test gate stays pending until the host callback or test releases it.
					new Promise((resolve) => {
						settle = () =>
							resolve(
								Exit.succeed({
									failure: null,
									startedAt: null,
									finishedAt: null,
									id: "operation-1",
									resetResult: null,
									kind: "delete" as const,
									status: "completed" as const,
									userId: UserId.make("user-0"),
									createdAt: "2026-09-01T00:00:00.000Z",
								}),
							);
					}),
			});
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" })),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Delete user" })),
			);
			const dialog = yield* Effect.promise(() =>
				screen.findByRole("dialog", { name: "Delete this user?" }),
			);
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete user" }));
			yield* Effect.promise(() => screen.findByRole("button", { name: "Deleting..." }));

			fireEvent.keyDown(document, { key: "Escape" });
			fireEvent.click(screen.getByRole("button", { name: "Close" }));
			expect(view.backInterceptors.run()).toBe(true);
			expect(dialog.isConnected).toBe(true);
			expect(
				within(dialog).getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled,
			).toBe(true);

			settle?.();
			yield* Effect.promise(() => waitFor(() => expect(dialog.isConnected).toBe(false)));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						view.calls.filter(
							(call) => typeof call === "object" && call !== null && "limit" in call,
						),
					).toHaveLength(2),
				),
			);
			expect(screen.getByText("reader-0@example.com")).toBeTruthy();
		}),
	);

	it.live(
		"refetches disabled state from the admin users recipe and discards shifted cursor pages",
		() =>
			Effect.gen(function* () {
				const user = userEvent.setup();
				const view = renderUsers(Array.from({ length: 51 }, (_, index) => makeUser(index)));
				yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
				yield* Effect.promise(() =>
					user.click(screen.getByRole("button", { name: "Load more users" })),
				);
				yield* Effect.promise(() => screen.findByText("reader-50@example.com"));

				yield* Effect.promise(() =>
					user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" })),
				);
				yield* Effect.promise(() =>
					user.click(screen.getByRole("menuitem", { name: "Disable user" })),
				);

				yield* Effect.promise(() => screen.findByText("Disabled"));
				expect(view.calls.at(-1)).toEqual({ limit: 50, search: "", after: undefined });
				expect(screen.getByText("Showing 50 of 51 users")).toBeTruthy();
				expect(screen.queryByText("reader-50@example.com")).toBeNull();
				yield* Effect.promise(() =>
					user.click(screen.getByRole("button", { name: "Load more users" })),
				);
				yield* Effect.promise(() => screen.findByText("reader-50@example.com"));
			}),
	);

	it.live("refetches after deletion so the first page and total reflect shifted users", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const view = renderUsers(Array.from({ length: 51 }, (_, index) => makeUser(index)));
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" })),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Delete user" })),
			);
			yield* Effect.promise(() =>
				user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete user" })),
			);

			yield* Effect.promise(() => screen.findByText("reader-50@example.com"));
			expect(view.calls.at(-1)).toEqual({ limit: 50, search: "", after: undefined });
			expect(screen.queryByText("reader-0@example.com")).toBeNull();
			expect(screen.getByText("Showing 50 of 50 users")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Load more users" })).toBeNull();
		}),
	);

	it.live("shows a retryable error if the admin list refresh fails after disabling", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const users = [makeUser(0)];
			const list = makeOperations(users, []).listUsers;
			let requests = 0;
			renderUsers(users, undefined, {
				listUsers: (search, after, limit) => {
					requests += 1;
					return requests === 2
						? Promise.resolve(Exit.fail(new AdminApiError({ cause: "offline" })))
						: list(search, after, limit);
				},
			});
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" })),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Disable user" })),
			);

			yield* Effect.promise(() => screen.findByRole("alert"));
			expect(screen.queryByText("reader-0@example.com")).toBeNull();
			yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Retry" })));
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			expect(requests).toBe(3);
			expect(screen.getByText("Enabled")).toBeTruthy();
		}),
	);

	it.live("rejects a list refresh when admin authorization expires after deletion", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const users = [makeUser(0)];
			const list = makeOperations(users, []).listUsers;
			let requests = 0;
			const view = renderUsers(users, undefined, {
				listUsers: (search, after, limit) => {
					requests += 1;
					return requests === 2
						? Promise.resolve(
								Exit.fail(new AuthUnauthorized({ reason: { code: "admin-access-required" } })),
							)
						: list(search, after, limit);
				},
			});
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" })),
			);
			yield* Effect.promise(() =>
				user.click(screen.getByRole("menuitem", { name: "Delete user" })),
			);
			yield* Effect.promise(() =>
				user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete user" })),
			);

			yield* Effect.promise(() => waitFor(() => expect(view.calls).toContain("unauthorized")));
			expect(requests).toBe(2);
			expect(screen.queryByText("reader-0@example.com")).toBeNull();
		}),
	);

	it.live("disables unavailable reset links and keeps the note in the menu", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			renderUsers([makeUser(0, "oidc")]);
			yield* Effect.promise(() => screen.findByText("reader-0@example.com"));
			const trigger = screen.getByRole("button", { name: "Actions for reader-0@example.com" });

			yield* Effect.promise(() => user.click(trigger));
			const menu = screen.getByRole("menu", { name: "User actions" });
			const resetLink = within(menu).getByRole<HTMLButtonElement>("menuitem", {
				name: "Generate reset link",
			});
			expect(resetLink.disabled).toBe(true);
			expect(
				within(menu).getByText("OIDC-only user: password reset links are unavailable."),
			).toBeTruthy();

			yield* Effect.promise(() => user.keyboard("{Escape}"));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(
						screen.queryByText("OIDC-only user: password reset links are unavailable."),
					).toBeNull(),
				),
			);
		}),
	);
});
