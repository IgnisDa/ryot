import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";
import { useState } from "react";

import { TwoFactorForm, type TwoFactorMethod } from "./two-factor-form";

function TwoFactorHarness(props: { onSubmit: (code: string) => Promise<string | undefined> }) {
	const [method, setMethod] = useState<TwoFactorMethod>("totp");
	return (
		<TwoFactorForm
			method={method}
			onBack={() => undefined}
			onSubmit={props.onSubmit}
			onMethodChange={setMethod}
		/>
	);
}

describe("two-factor form", () => {
	it("requires a code before submission", async () => {
		const submitted: string[] = [];
		const submit = (code: string) => {
			submitted.push(code);
			return Promise.resolve(undefined);
		};
		await render(<TwoFactorHarness onSubmit={submit} />);

		await fireEvent(screen.getByLabelText("Authenticator code"), "submitEditing");

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Enter your two-factor authentication code.",
		);
		expect(submitted).toEqual([]);
	});

	it("submits a trimmed code from the keyboard", async () => {
		const user = userEvent.setup();
		const submitted: string[] = [];
		const submit = (code: string) => {
			submitted.push(code);
			return Promise.resolve(undefined);
		};
		await render(<TwoFactorHarness onSubmit={submit} />);
		await user.press(screen.getByRole("button", { name: "Use a backup code" }));
		const input = screen.getByLabelText("Backup code");

		await user.type(input, " 123456 ");
		await fireEvent(input, "submitEditing");

		expect(submitted).toEqual(["123456"]);
	});

	it("clears the code after a rejected submission", async () => {
		const user = userEvent.setup();
		await render(<TwoFactorHarness onSubmit={() => Promise.resolve("That code is invalid.")} />);

		await user.type(screen.getByLabelText("Authenticator code"), "123456");
		await user.press(screen.getByRole("button", { name: "Verify" }));

		expect(await screen.findByRole("alert")).toHaveTextContent("That code is invalid.");
		expect(screen.getByLabelText("Authenticator code")).toHaveDisplayValue("");
	});

	it("resets the field when switching to a backup code", async () => {
		const user = userEvent.setup();
		await render(<TwoFactorHarness onSubmit={() => Promise.resolve(undefined)} />);

		await user.type(screen.getByLabelText("Authenticator code"), "123456");
		await user.press(screen.getByRole("button", { name: "Use a backup code" }));

		expect(screen.getByLabelText("Backup code")).toHaveDisplayValue("");
	});
});
