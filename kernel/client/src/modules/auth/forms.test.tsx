import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AuthMode, TwoFactorMethod } from "./flow";
import { CredentialsForm, TwoFactorForm } from "./forms";

const MODE_SWITCHER = { name: "Authentication mode" };

const modeSwitcher = () => within(screen.getByRole("group", MODE_SWITCHER));

const submitButton = () =>
	screen.getAllByRole<HTMLButtonElement>("button").filter((button) => button.type === "submit")[0];

function renderCredentialsForm(overrides?: {
	mode?: AuthMode;
	disabled?: boolean;
	signupAllowed?: boolean;
}) {
	const onModeChange = vi.fn();
	const onSubmit = vi.fn<
		(values: { email: string; password: string }) => Promise<string | undefined>
	>(async () => undefined);
	const props = {
		onSubmit,
		onModeChange,
		disabled: overrides?.disabled ?? false,
		mode: overrides?.mode ?? ("login" as AuthMode),
		signupAllowed: overrides?.signupAllowed ?? true,
	};
	const view = render(<CredentialsForm {...props} />);

	return { view, props, onSubmit, onModeChange, user: userEvent.setup() };
}

function renderTwoFactorForm(overrides?: {
	method?: TwoFactorMethod;
	methods?: readonly TwoFactorMethod[];
}) {
	const onBack = vi.fn();
	const onMethodChange = vi.fn();
	const onSubmit = vi.fn<(code: string) => Promise<string | undefined>>(async () => undefined);
	const props = {
		onBack,
		onSubmit,
		onMethodChange,
		method: overrides?.method ?? ("totp" as TwoFactorMethod),
		methods: overrides?.methods ?? (["totp", "backupCode"] as const),
	};
	const view = render(<TwoFactorForm {...props} />);

	return { view, props, onBack, onSubmit, onMethodChange, user: userEvent.setup() };
}

describe("credentials form", () => {
	it("shows the mode switcher only when signup is allowed", () => {
		const { view } = renderCredentialsForm({ signupAllowed: false });

		expect(screen.queryByRole("group", MODE_SWITCHER)).toBeNull();

		view.rerender(
			<CredentialsForm
				mode="login"
				signupAllowed
				disabled={false}
				onModeChange={vi.fn()}
				onSubmit={async () => undefined}
			/>,
		);

		const switcher = modeSwitcher();
		expect(switcher.getByRole("button", { name: "Sign in" }).getAttribute("aria-pressed")).toBe(
			"true",
		);
		expect(switcher.getByRole("button", { name: "Sign up" }).getAttribute("aria-pressed")).toBe(
			"false",
		);
	});

	it("keeps the email and clears the password when switching to signup", async () => {
		const { user, onModeChange } = renderCredentialsForm();
		const email = screen.getByLabelText<HTMLInputElement>("Email address");
		const password = screen.getByLabelText<HTMLInputElement>("Password");

		await user.type(email, "user@example.com");
		await user.type(password, "Sup3rSecret");
		await user.click(modeSwitcher().getByRole("button", { name: "Sign up" }));

		expect(onModeChange).toHaveBeenCalledWith("signup");
		expect(email.value).toBe("user@example.com");
		expect(password.value).toBe("");
	});

	it("moves focus to the password field when Enter is pressed in the email field", async () => {
		const { user, onSubmit } = renderCredentialsForm();

		await user.type(screen.getByLabelText("Email address"), "user@example.com{Enter}");

		expect(document.activeElement).toBe(screen.getByLabelText("Password"));
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("submits normalized credentials once", async () => {
		const { user, onSubmit } = renderCredentialsForm();

		await user.type(screen.getByLabelText("Email address"), "  USER@Example.COM  ");
		await user.type(screen.getByLabelText("Password"), "Sup3rSecret");
		await user.click(submitButton());

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit).toHaveBeenCalledWith({
			password: "Sup3rSecret",
			email: "user@example.com",
		});
	});

	it("shows a submission error until the password changes", async () => {
		const { user, onSubmit } = renderCredentialsForm();
		onSubmit.mockResolvedValue("Invalid credentials.");

		await user.type(screen.getByLabelText("Email address"), "user@example.com");
		await user.type(screen.getByLabelText("Password"), "Sup3rSecret");
		await user.click(submitButton());

		expect(screen.getByRole("alert").textContent).toBe("Invalid credentials.");

		await user.type(screen.getByLabelText("Password"), "!");

		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("blocks submission while a blurred field is invalid", async () => {
		const { user } = renderCredentialsForm();

		await user.type(screen.getByLabelText("Email address"), "not-an-email");
		await user.tab();

		expect(screen.getByText("Enter a valid email address.").getAttribute("role")).toBe("alert");
		expect(submitButton().disabled).toBe(true);

		await user.type(screen.getByLabelText("Password"), "short");
		await user.tab();

		expect(screen.getByText("Password must be at least 8 characters.").getAttribute("role")).toBe(
			"alert",
		);
		expect(submitButton().disabled).toBe(true);
	});

	it("disables every input and mode button when disabled", () => {
		renderCredentialsForm({ disabled: true });
		const switcher = modeSwitcher();

		expect(screen.getByLabelText<HTMLInputElement>("Email address").disabled).toBe(true);
		expect(screen.getByLabelText<HTMLInputElement>("Password").disabled).toBe(true);
		expect(switcher.getByRole<HTMLButtonElement>("button", { name: "Sign in" }).disabled).toBe(
			true,
		);
		expect(switcher.getByRole<HTMLButtonElement>("button", { name: "Sign up" }).disabled).toBe(
			true,
		);
	});
});

describe("two-factor form", () => {
	it("renders the field for the selected method", () => {
		const { view } = renderTwoFactorForm();
		const totp = screen.getByLabelText("Authenticator code");

		expect(totp.getAttribute("maxlength")).toBe("6");
		expect(totp.getAttribute("inputmode")).toBe("numeric");

		view.rerender(
			<TwoFactorForm
				method="backupCode"
				methods={["totp", "backupCode"]}
				onBack={vi.fn()}
				onMethodChange={vi.fn()}
				onSubmit={async () => undefined}
			/>,
		);

		const backupCode = screen.getByLabelText("Backup code");
		expect(backupCode.getAttribute("maxlength")).toBeNull();
		expect(backupCode.getAttribute("inputmode")).toBe("text");
	});

	it("offers a method switch only when more than one method exists", async () => {
		const single = renderTwoFactorForm({ methods: ["totp"] });

		expect(screen.queryByRole("button", { name: "Use a backup code" })).toBeNull();

		single.view.unmount();
		const { user, onMethodChange } = renderTwoFactorForm();
		await user.click(screen.getByRole("button", { name: "Use a backup code" }));

		expect(onMethodChange).toHaveBeenCalledWith("backupCode");
	});

	it("submits the trimmed code", async () => {
		const { user, onSubmit } = renderTwoFactorForm({ method: "backupCode" });

		await user.type(screen.getByLabelText("Backup code"), " 123456 ");
		await user.click(screen.getByRole("button", { name: "Verify" }));

		expect(onSubmit).toHaveBeenCalledWith("123456");
	});

	it("shows a submission error and clears the code", async () => {
		const { user, onSubmit } = renderTwoFactorForm();
		onSubmit.mockResolvedValue("That code did not work.");

		await user.type(screen.getByLabelText("Authenticator code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify" }));

		expect(screen.getByRole("alert").textContent).toBe("That code did not work.");
		expect(screen.getByLabelText<HTMLInputElement>("Authenticator code").value).toBe("");
	});

	it("returns to sign in", async () => {
		const { user, onBack } = renderTwoFactorForm();

		await user.click(screen.getByRole("button", { name: "Back to sign in" }));

		expect(onBack).toHaveBeenCalledTimes(1);
	});
});
