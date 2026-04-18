import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";

import { TokenForm } from "./token-form";

function TokenFormWithServerError(props: { onSubmit: (token: string) => void }) {
	const [error, setError] = useState<string | null>("That admin access token is invalid.");
	return <TokenForm error={error} onSubmit={props.onSubmit} onEdit={() => setError(null)} />;
}

describe("admin token form", () => {
	it("requires a token before submission", async () => {
		const onSubmit = jest.fn<(token: string) => void>();
		await render(<TokenForm onSubmit={onSubmit} onEdit={() => undefined} />);

		expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
		await fireEvent(screen.getByLabelText("Admin access token"), "submitEditing");

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Enter your server admin access token.",
		);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("submits a trimmed token from the primary action", async () => {
		const user = userEvent.setup();
		const onSubmit = jest.fn<(token: string) => void>();
		await render(<TokenForm onSubmit={onSubmit} onEdit={() => undefined} />);

		await user.type(screen.getByLabelText("Admin access token"), "  secret  ");
		await user.press(screen.getByRole("button", { name: "Continue" }));

		expect(onSubmit).toHaveBeenCalledWith("secret");
	});

	it("submits from the keyboard", async () => {
		const user = userEvent.setup();
		const onSubmit = jest.fn<(token: string) => void>();
		await render(<TokenForm onSubmit={onSubmit} onEdit={() => undefined} />);
		const input = screen.getByLabelText("Admin access token");

		await user.type(input, "secret");
		await fireEvent(input, "submitEditing");

		expect(onSubmit).toHaveBeenCalledWith("secret");
	});

	it("clears a server rejection when the user edits the token", async () => {
		const user = userEvent.setup();
		await render(<TokenFormWithServerError onSubmit={() => undefined} />);

		expect(screen.getByRole("alert")).toHaveTextContent("That admin access token is invalid.");
		await user.type(screen.getByLabelText("Admin access token"), "replacement");

		expect(screen.queryByText("That admin access token is invalid.")).not.toBeOnTheScreen();
	});
});
