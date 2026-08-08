import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import { BackupRestoreConfirmStep } from "./backup-restore-confirm-step";

const renderConfirm = (
	overrides: {
		readonly pending?: boolean;
		readonly onBack?: () => void;
		readonly onRestore?: () => void;
		readonly failureDetail?: string;
	} = {},
) =>
	render(
		<BackupRestoreConfirmStep
			pending={overrides.pending ?? false}
			failureDetail={overrides.failureDetail}
			onBack={overrides.onBack ?? (() => undefined)}
			onRestore={overrides.onRestore ?? (() => undefined)}
		/>,
	);

describe("backup restore confirm step", () => {
	it("states what the restore requires and that it cannot be taken back", async () => {
		await renderConfirm();

		expect(
			screen.getByText(
				"This account must be new and empty. If it already holds anything, the restore stops without changing it.",
			),
		).toBeOnTheScreen();
		expect(
			screen.getByText(
				"This cannot be undone, and it cannot be repeated without resetting the account first.",
			),
		).toBeOnTheScreen();
	});

	it("starts the restore, and goes back to the file instead", async () => {
		const user = userEvent.setup();
		const backs: number[] = [];
		const restores: number[] = [];
		await renderConfirm({ onBack: () => backs.push(1), onRestore: () => restores.push(1) });

		await user.press(screen.getByRole("button", { name: "Restore this backup" }));
		await user.press(screen.getByRole("button", { name: "Back to choosing a file" }));

		expect(restores).toEqual([1]);
		expect(backs).toEqual([1]);
	});

	it("refuses a second start while the restore is being handed to the server", async () => {
		const user = userEvent.setup();
		const backs: number[] = [];
		const restores: number[] = [];
		await renderConfirm({
			pending: true,
			onBack: () => backs.push(1),
			onRestore: () => restores.push(1),
		});
		const restore = screen.getByRole("button", { name: "Starting..." });

		await user.press(restore);
		await user.press(screen.getByRole("button", { name: "Back to choosing a file" }));

		expect(restore).toBeDisabled();
		expect(restores).toEqual([]);
		expect(backs).toEqual([]);
	});

	it("keeps a failed restore on this step with what went wrong", async () => {
		await renderConfirm({
			failureDetail: "This account already had data in it, so nothing was changed.",
		});

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"This account already had data in it, so nothing was changed.",
		);
	});
});
