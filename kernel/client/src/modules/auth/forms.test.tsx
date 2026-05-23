import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { AuthMode, TwoFactorMethod } from "./flow";
import type { CredentialsValues } from "./form-values";
import { CredentialsForm, TwoFactorForm } from "./forms";

const MODE_SWITCHER = { name: "Authentication mode" };

const modeSwitcher = () => within(screen.getByRole("group", MODE_SWITCHER));

const submitButton = () => {
	const button = screen
		.getAllByRole<HTMLButtonElement>("button")
		.find((candidate) => candidate.type === "submit");
	if (!button) {
		throw new Error("Missing submit button");
	}
	return button;
};

function renderCredentialsForm(overrides?: {
	mode?: AuthMode;
	disabled?: boolean;
	submitError?: string;
	signupAllowed?: boolean;
}) {
	const modeChanges: AuthMode[] = [];
	const submissions: CredentialsValues[] = [];
	const onModeChange = (mode: AuthMode) => modeChanges.push(mode);
	const onSubmit = (values: CredentialsValues) => {
		submissions.push(values);
		return Promise.resolve(overrides?.submitError);
	};
	const props = {
		onSubmit,
		onModeChange,
		disabled: overrides?.disabled ?? false,
		mode: overrides?.mode ?? ("login" as AuthMode),
		signupAllowed: overrides?.signupAllowed ?? true,
	};
	const view = render(<CredentialsForm {...props} />);

	return { modeChanges, props, submissions, user: userEvent.setup(), view };
}

function renderTwoFactorForm(overrides?: {
	submitError?: string;
	method?: TwoFactorMethod;
	methods?: readonly TwoFactorMethod[];
}) {
	const backRequests: true[] = [];
	const submissions: string[] = [];
	const methodChanges: TwoFactorMethod[] = [];
	const onBack = () => backRequests.push(true);
	const onMethodChange = (method: TwoFactorMethod) => methodChanges.push(method);
	const onSubmit = (code: string) => {
		submissions.push(code);
		return Promise.resolve(overrides?.submitError);
	};
	const props = {
		onBack,
		onSubmit,
		onMethodChange,
		method: overrides?.method ?? ("totp" as TwoFactorMethod),
		methods: overrides?.methods ?? (["totp", "backupCode"] as const),
	};
	const view = render(<TwoFactorForm {...props} />);

	return { backRequests, methodChanges, props, submissions, user: userEvent.setup(), view };
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
				onModeChange={() => undefined}
				onSubmit={() => Promise.resolve(undefined)}
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
		const { modeChanges, user } = renderCredentialsForm();
		const email = screen.getByLabelText<HTMLInputElement>("Email address");
		const password = screen.getByLabelText<HTMLInputElement>("Password");

		await user.type(email, "user@example.com");
		await user.type(password, "Sup3rSecret");
		await user.click(modeSwitcher().getByRole("button", { name: "Sign up" }));

		expect(modeChanges).toEqual(["signup"]);
		expect(email.value).toBe("user@example.com");
		expect(password.value).toBe("");
	});

	it("moves focus to the password field when Enter is pressed in the email field", async () => {
		const { submissions, user } = renderCredentialsForm();

		await user.type(screen.getByLabelText("Email address"), "user@example.com{Enter}");

		expect(document.activeElement).toBe(screen.getByLabelText("Password"));
		expect(submissions).toEqual([]);
	});

	it("submits normalized credentials once", async () => {
		const { submissions, user } = renderCredentialsForm();

		await user.type(screen.getByLabelText("Email address"), "  USER@Example.COM  ");
		await user.type(screen.getByLabelText("Password"), "Sup3rSecret");
		await user.click(submitButton());

		expect(submissions).toEqual([
			{
				password: "Sup3rSecret",
				email: "user@example.com",
			},
		]);
	});

	it("shows a submission error until the password changes", async () => {
		const { user } = renderCredentialsForm({ submitError: "Invalid credentials." });

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
				onBack={() => undefined}
				onMethodChange={() => undefined}
				onSubmit={() => Promise.resolve(undefined)}
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
		const { methodChanges, user } = renderTwoFactorForm();
		await user.click(screen.getByRole("button", { name: "Use a backup code" }));

		expect(methodChanges).toEqual(["backupCode"]);
	});

	it("submits the trimmed code", async () => {
		const { submissions, user } = renderTwoFactorForm({ method: "backupCode" });

		await user.type(screen.getByLabelText("Backup code"), " 123456 ");
		await user.click(screen.getByRole("button", { name: "Verify" }));

		expect(submissions).toEqual(["123456"]);
	});

	it("shows a submission error and clears the code", async () => {
		const { user } = renderTwoFactorForm({ submitError: "That code did not work." });

		await user.type(screen.getByLabelText("Authenticator code"), "123456");
		await user.click(screen.getByRole("button", { name: "Verify" }));

		expect(screen.getByRole("alert").textContent).toBe("That code did not work.");
		expect(screen.getByLabelText<HTMLInputElement>("Authenticator code").value).toBe("");
	});

	it("returns to sign in", async () => {
		const { backRequests, user } = renderTwoFactorForm();

		await user.click(screen.getByRole("button", { name: "Back to sign in" }));

		expect(backRequests).toEqual([true]);
	});
});
