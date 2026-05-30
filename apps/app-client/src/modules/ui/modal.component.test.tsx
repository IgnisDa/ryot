import { describe, expect, it } from "@jest/globals";
import { render, screen, userEvent } from "@testing-library/react-native";
import { Text } from "react-native";

import { AppModal } from "./modal";

describe("app modal", () => {
	it("renders its content and closes from the backdrop", async () => {
		const user = userEvent.setup();
		const closeCalls: string[] = [];
		await render(
			<AppModal visible closeLabel="Close test modal" onClose={() => closeCalls.push("closed")}>
				<Text>Modal content</Text>
			</AppModal>,
		);

		expect(screen.getByText("Modal content")).toBeOnTheScreen();
		await user.press(screen.getByRole("button", { name: "Close test modal" }));
		expect(closeCalls).toEqual(["closed"]);
	});

	it("hides its content when not visible", async () => {
		await render(
			<AppModal visible={false} closeLabel="Close test modal" onClose={() => undefined}>
				<Text>Modal content</Text>
			</AppModal>,
		);

		expect(screen.queryByText("Modal content")).not.toBeOnTheScreen();
	});
});
