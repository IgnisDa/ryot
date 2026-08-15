import { describe, expect, it } from "@jest/globals";
import { UserId } from "@ryot/contract/schema/brands";
import { useTable } from "@tanstack/react-table";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { Exit } from "effect";

import type { GodModeUser } from "@/modules/god-mode/atoms";
import type {
	GodModeUserLifecycleOperation,
	GodModeUserResetResult,
} from "@/modules/god-mode/user-lifecycle";
import { type GodModeUserActions, GodModeUserRow } from "@/modules/god-mode/user-row";
import {
	godModeUserTableColumns,
	godModeUserTableFeatures,
} from "@/modules/god-mode/user-table-model";

const userRow = {
	id: "user-1",
	name: "Reader",
	disabledAt: null,
	authState: "credential",
	twoFactorEnabled: false,
	email: "reader@example.com",
	createdAt: "2026-08-24T00:00:00.000Z",
} as const satisfies GodModeUser;

const resetResult = {
	email: userRow.email,
	userId: UserId.make(userRow.id),
	resetUrl: "https://example.com/reset-password?token=secret",
} satisfies GodModeUserResetResult;

const noopFinish = (_result: Exit.Exit<GodModeUserResetResult>) => {};

const actions = (overrides: Partial<GodModeUserActions> = {}): GodModeUserActions => ({
	deleteUser: () =>
		Promise.resolve(
			Exit.succeed({
				error: null,
				kind: "delete",
				startedAt: null,
				resetResult: null,
				id: "operation-1",
				status: "completed",
				createdAt: "2026-08-24T00:00:00.000Z",
				userId: UserId.make(userRow.id),
				finishedAt: "2026-08-24T00:00:00.000Z",
			}),
		),
	resetUser: () => Promise.resolve(Exit.succeed(resetResult)),
	resetPassword: () =>
		Promise.resolve(Exit.succeed({ email: userRow.email, resetUrl: resetResult.resetUrl })),
	setDisabled: () => Promise.resolve(Exit.succeed({ id: userRow.id, disabledAt: null })),
	...overrides,
});

function TestUserRow(props: { readonly user: GodModeUser; readonly actions: GodModeUserActions }) {
	const table = useTable({
		data: [props.user],
		manualFiltering: true,
		manualPagination: true,
		getRowId: (user) => user.id,
		columns: godModeUserTableColumns,
		features: godModeUserTableFeatures,
	});
	const row = table.getRowModel().rows[0];

	return <GodModeUserRow row={row} actions={props.actions} onUnauthorized={() => undefined} />;
}

const pressSheetControl = async (role: "button" | "menuitem", name: string) =>
	act(async () => {
		screen.getByRole(role, { name }).props.onClick({ nativeEvent: {} });
		await Promise.resolve();
	});

describe("God-mode user lifecycle actions", () => {
	it("keeps destructive actions locked and exposes the completed reset result", async () => {
		const appUser = userEvent.setup();
		let finish = noopFinish;
		let resetCount = 0;
		await render(
			<TestUserRow
				user={userRow}
				actions={actions({
					resetUser: () => {
						resetCount += 1;
						return new Promise((resolve) => {
							finish = resolve;
						});
					},
				})}
			/>,
		);

		await appUser.press(screen.getByRole("button", { name: `Actions for ${userRow.email}` }));
		await pressSheetControl("menuitem", "Reset account");
		await pressSheetControl("button", "Reset account");

		expect(await screen.findByRole("button", { name: "Resetting..." })).toBeDisabled();
		await pressSheetControl("button", "Resetting...");
		expect(resetCount).toBe(1);

		finish(Exit.succeed(resetResult));

		expect(await screen.findByDisplayValue(resetResult.resetUrl)).toBeOnTheScreen();
		expect(screen.getByText(`Reset link for ${userRow.email}`)).toBeOnTheScreen();
	});

	it("keeps failed operation details out of user-facing copy", async () => {
		const appUser = userEvent.setup();
		const internalFailure = {
			kind: "reset",
			startedAt: null,
			status: "failed",
			resetResult: null,
			id: "operation-1",
			createdAt: "2026-08-24T00:00:00.000Z",
			userId: UserId.make(userRow.id),
			finishedAt: "2026-08-24T00:00:00.000Z",
			error: "database cleanup failed at step 4",
		} as const satisfies GodModeUserLifecycleOperation;
		await render(
			<TestUserRow
				user={userRow}
				actions={actions({ resetUser: () => Promise.resolve(Exit.fail(internalFailure)) })}
			/>,
		);

		await appUser.press(screen.getByRole("button", { name: `Actions for ${userRow.email}` }));
		await pressSheetControl("menuitem", "Reset account");
		await pressSheetControl("button", "Reset account");

		expect(await screen.findByText("Could not reset this user. Try again.")).toBeOnTheScreen();
		expect(screen.queryByText(/database cleanup|step 4/)).not.toBeOnTheScreen();
	});

	it("blocks reset links for OIDC-only users while keeping other actions available", async () => {
		const appUser = userEvent.setup();
		let deleteCount = 0;
		await render(
			<TestUserRow
				user={{ ...userRow, authState: "oidc" }}
				actions={actions({
					deleteUser: () => {
						deleteCount += 1;
						return Promise.resolve(
							Exit.succeed({
								error: null,
								kind: "delete",
								startedAt: null,
								resetResult: null,
								id: "operation-1",
								status: "completed",
								createdAt: "2026-08-24T00:00:00.000Z",
								userId: UserId.make(userRow.id),
								finishedAt: "2026-08-24T00:00:00.000Z",
							}),
						);
					},
				})}
			/>,
		);

		await appUser.press(screen.getByRole("button", { name: `Actions for ${userRow.email}` }));

		expect(screen.getByRole("menuitem", { name: "Generate reset link" })).toBeDisabled();
		expect(screen.getByText("OIDC-only user")).toBeOnTheScreen();

		await pressSheetControl("menuitem", "Delete user");
		await pressSheetControl("button", "Delete user");

		expect(deleteCount).toBe(1);
	});
});
