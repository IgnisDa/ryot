import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";

import { CredentialsForm, type AuthMode } from "./credentials-form";

function CredentialsHarness(props: {
	onSubmit: (values: { email: string; password: string }) => Promise<string | undefined>;
}) {
	const [mode, setMode] = useState<AuthMode>("login");
	return (
		<CredentialsForm mode={mode} onModeChange={setMode} onSubmit={props.onSubmit} signupAllowed />
	);
}

describe("credentials form", () => {
	it("shows field validation errors and prevents invalid submission", async () => {
		const user = userEvent.setup();
		const submit = jest.fn(() => Promise.resolve(undefined));
		await render(<CredentialsHarness onSubmit={submit} />);

		await user.type(screen.getByLabelText("Email address"), "invalid");
		await user.type(screen.getByLabelText("Password"), "short");
		await fireEvent(screen.getByLabelText("Password"), "submitEditing");

		expect(screen.getByText("Enter a valid email address.")).toBeOnTheScreen();
		expect(screen.getByText("Password must be at least 8 characters.")).toBeOnTheScreen();
		expect(submit).not.toHaveBeenCalled();
	});

	it("normalizes the email before submission", async () => {
		const user = userEvent.setup();
		const submit = jest.fn(() => Promise.resolve(undefined));
		await render(<CredentialsHarness onSubmit={submit} />);

		await user.type(screen.getByLabelText("Email address"), "  User@Example.com  ");
		await user.type(screen.getByLabelText("Password"), "password");
		await user.press(screen.getByRole("button", { name: "Sign in" }));

		expect(submit).toHaveBeenCalledWith({ password: "password", email: "user@example.com" });
	});

	it("shows submission errors until the user edits a field", async () => {
		const user = userEvent.setup();
		const submit = jest.fn(() => Promise.resolve("Could not sign in."));
		await render(<CredentialsHarness onSubmit={submit} />);

		await user.type(screen.getByLabelText("Email address"), "user@example.com");
		await user.type(screen.getByLabelText("Password"), "password");
		await user.press(screen.getByRole("button", { name: "Sign in" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not sign in.");

		await user.type(screen.getByLabelText("Password"), "2");
		expect(screen.queryByText("Could not sign in.")).not.toBeOnTheScreen();
	});

	it("clears the password when changing auth mode", async () => {
		const user = userEvent.setup();
		await render(<CredentialsHarness onSubmit={() => Promise.resolve(undefined)} />);

		await user.type(screen.getByLabelText("Email address"), "user@example.com");
		await user.type(screen.getByLabelText("Password"), "password");
		await user.press(screen.getByRole("tab", { name: "Sign up" }));

		expect(screen.getByLabelText("Email address")).toHaveDisplayValue("user@example.com");
		expect(screen.getByLabelText("Password")).toHaveDisplayValue("");
	});
});
