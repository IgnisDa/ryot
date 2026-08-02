import { UserId } from "@ryot-app/contract/schema/brands";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Exit } from "effect";
import { describe, expect, it } from "vitest";

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

const makeOperations = (users: ReadonlyArray<GodModeUser>, calls: Array<unknown>) =>
	({
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
			return Promise.resolve(
				Exit.succeed({ id: userId, disabledAt: disabled ? "2026-09-02T00:00:00.000Z" : null }),
			);
		},
		listUsers: (search, offset, limit) => {
			calls.push({ limit, search, offset });
			const matching = users.filter((user) => user.email.includes(search));
			return Promise.resolve(
				Exit.succeed({ total: matching.length, users: matching.slice(offset, offset + limit) }),
			);
		},
		deleteUser: () =>
			Promise.resolve(
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
			),
	}) satisfies GodModeUserOperations;

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
	it("loads 50-user pages, preserves loaded rows, and trims debounced searches", async () => {
		const user = userEvent.setup();
		const users = Array.from({ length: 51 }, (_, index) => makeUser(index));
		const view = renderUsers(users);

		await screen.findByText("reader-0@example.com");
		expect(screen.queryByText("reader-50@example.com")).toBeNull();
		await user.click(screen.getByRole("button", { name: "Load more users" }));
		await screen.findByText("reader-50@example.com");
		expect(screen.getByText("reader-0@example.com")).toBeTruthy();

		fireEvent.change(screen.getByRole("searchbox"), {
			target: { value: "  reader-50@example.com  " },
		});
		await waitFor(
			() =>
				expect(view.calls).toContainEqual({
					limit: 50,
					offset: 0,
					search: "reader-50@example.com",
				}),
			{ timeout: 700 },
		);
		expect(await screen.findByText("reader-50@example.com")).toBeTruthy();
		expect(screen.queryByText("reader-0@example.com")).toBeNull();
	});

	it("shows a reset-password result and injects reset-link transfer", async () => {
		const user = userEvent.setup();
		const transferred: string[] = [];
		renderUsers([makeUser(0)], (url) => {
			transferred.push(url);
			return Promise.resolve("copied");
		});
		await screen.findByText("reader-0@example.com");

		await user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" }));
		await user.click(screen.getByRole("menuitem", { name: "Generate reset link" }));
		const resetLink = await screen.findByLabelText<HTMLInputElement>("Password reset link");
		expect(resetLink.value).toBe("https://example.com/reset");
		await user.click(screen.getByRole("button", { name: "Copy or share" }));
		expect(transferred).toEqual(["https://example.com/reset"]);
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "Copied!" }).disabled).toBe(true);
	});

	it("opens and dismisses the accessible action menu", async () => {
		const user = userEvent.setup();
		const view = renderUsers([makeUser(0)]);
		await screen.findByText("reader-0@example.com");
		const trigger = screen.getByRole("button", { name: "Actions for reader-0@example.com" });
		expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		await user.click(trigger);
		const menu = await screen.findByRole("menu", { name: "User actions" });
		const generate = within(menu).getByRole("menuitem", { name: "Generate reset link" });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(trigger.getAttribute("aria-controls")).toBe(menu.id);
		expect(document.activeElement).toBe(generate);

		await user.keyboard("{ArrowDown}");
		expect(document.activeElement).toBe(
			within(menu).getByRole("menuitem", { name: "Disable user" }),
		);
		await user.keyboard("{End}");
		expect(document.activeElement).toBe(
			within(menu).getByRole("menuitem", { name: "Delete user" }),
		);
		await user.keyboard("{Home}");
		expect(document.activeElement).toBe(generate);

		fireEvent.keyDown(menu, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));

		await user.click(trigger);
		await user.click(document.body);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

		await user.click(trigger);
		expect(view.backInterceptors.run()).toBe(true);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it("restores focus to the action trigger after destructive confirmation", async () => {
		const user = userEvent.setup();
		const view = renderUsers([makeUser(0)]);
		await screen.findByText("reader-0@example.com");
		const trigger = screen.getByRole("button", { name: "Actions for reader-0@example.com" });

		await user.click(trigger);
		await user.click(screen.getByRole("menuitem", { name: "Reset account" }));
		const dialog = await screen.findByRole("dialog", { name: "Reset this user?" });
		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));

		await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));

		await user.click(trigger);
		await user.click(screen.getByRole("menuitem", { name: "Delete user" }));
		const deleteDialog = await screen.findByRole("dialog", { name: "Delete this user?" });
		expect(view.backInterceptors.run()).toBe(true);
		await waitFor(() => expect(deleteDialog.isConnected).toBe(false));
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it("contains dialog Tab focus and closes the confirmation on Escape", async () => {
		const user = userEvent.setup();
		renderUsers([makeUser(0)]);
		await screen.findByText("reader-0@example.com");

		await user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" }));
		await user.click(screen.getByRole("menuitem", { name: "Reset account" }));
		const dialog = await screen.findByRole("dialog", { name: "Reset this user?" });
		const cancel = within(dialog).getByRole("button", { name: "Cancel" });
		const confirm = within(dialog).getByRole("button", { name: "Reset account" });
		expect(document.activeElement).toBe(cancel);

		fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(confirm);
		fireEvent.keyDown(dialog, { key: "Tab" });
		expect(document.activeElement).toBe(cancel);

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("refuses every dismissal while the destructive operation is pending", async () => {
		const user = userEvent.setup();
		let settle: (() => void) | undefined;
		const view = renderUsers([makeUser(0)], undefined, {
			deleteUser: () =>
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
		await screen.findByText("reader-0@example.com");

		await user.click(screen.getByRole("button", { name: "Actions for reader-0@example.com" }));
		await user.click(screen.getByRole("menuitem", { name: "Delete user" }));
		const dialog = await screen.findByRole("dialog", { name: "Delete this user?" });
		fireEvent.click(within(dialog).getByRole("button", { name: "Delete user" }));
		await screen.findByRole("button", { name: "Deleting..." });

		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(view.backInterceptors.run()).toBe(true);
		expect(dialog.isConnected).toBe(true);
		expect(within(dialog).getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(
			true,
		);

		settle?.();
		await waitFor(() => expect(dialog.isConnected).toBe(false));
		expect(screen.queryByText("reader-0@example.com")).toBeNull();
	});

	it("disables unavailable reset links and keeps the note in the menu", async () => {
		const user = userEvent.setup();
		renderUsers([makeUser(0, "oidc")]);
		await screen.findByText("reader-0@example.com");
		const trigger = screen.getByRole("button", { name: "Actions for reader-0@example.com" });

		await user.click(trigger);
		const menu = screen.getByRole("menu", { name: "User actions" });
		const resetLink = within(menu).getByRole<HTMLButtonElement>("menuitem", {
			name: "Generate reset link",
		});
		expect(resetLink.disabled).toBe(true);
		expect(
			within(menu).getByText("OIDC-only user: password reset links are unavailable."),
		).toBeTruthy();

		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(
				screen.queryByText("OIDC-only user: password reset links are unavailable."),
			).toBeNull(),
		);
	});
});
