import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";

import { BottomSheet } from "@/modules/ui/bottom-sheet";
import { DestructiveActionSheet } from "@/modules/ui/destructive-action-sheet";

describe("integration deletion confirmation", () => {
	it("disables actions and dismissal while deletion is pending", async () => {
		const user = userEvent.setup();
		let closeCount = 0;
		const props = {
			pending: true,
			snapPoints: [300],
			onConfirm: () => undefined,
			pendingLabel: "Deleting...",
			title: "Delete this integration?",
			actionLabel: "Delete integration",
			detail: "This permanently deletes Test integration.",
			onClose: () => {
				closeCount += 1;
			},
		};
		const sheet = DestructiveActionSheet(props);
		const nativeSheet = BottomSheet(sheet.props);

		expect(sheet.props.dismissible).toBe(false);
		expect(nativeSheet.props.enablePanDownToClose).toBe(false);
		nativeSheet.props.onClose();
		expect(closeCount).toBe(0);

		await render(<DestructiveActionSheet {...props} />);

		expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled();

		await user.press(screen.getByRole("button", { name: "Keep it" }));
		expect(closeCount).toBe(0);
	});
});
