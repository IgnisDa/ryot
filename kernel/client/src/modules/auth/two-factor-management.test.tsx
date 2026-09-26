import { describe, expect, it } from "@effect/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect } from "effect";

import { HostedAuthError } from "#/modules/auth/hosted-service";
import { TwoFactorManagement } from "#/modules/auth/two-factor-management";

const totpURI = "otpauth://totp/Ryot:user%40ryot.example?secret=JBSWY3DPEHPK3PXP&issuer=Ryot";

const passwordCheck = (password: string) =>
	password === "correct-password"
		? Effect.void
		: Effect.fail(new HostedAuthError({ message: "Invalid password" }));

const renderManagement = (enabled: boolean, signInPassword = "correct-password") => {
	const calls: string[] = [];
	const done: true[] = [];
	render(
		<TwoFactorManagement
			enabled={enabled}
			password={signInPassword}
			onDone={() => done.push(true)}
			actions={{
				disableTwoFactor: (password) => {
					calls.push(`disable:${password}`);
					return passwordCheck(password);
				},
				regenerateBackupCodes: (password) => {
					calls.push(`regenerate:${password}`);
					return passwordCheck(password).pipe(Effect.as(["fresh-code-1", "fresh-code-2"]));
				},
				confirmTwoFactor: (code) => {
					calls.push(`confirm:${code}`);
					return code === "123456"
						? Effect.void
						: Effect.fail(new HostedAuthError({ message: "Invalid code" }));
				},
				enableTwoFactor: (password) => {
					calls.push(`enable:${password}`);
					return passwordCheck(password).pipe(
						Effect.as({
							totpURI,
							secret: "JBSWY3DPEHPK3PXP",
							backupCodes: ["setup-code-1", "setup-code-2"],
						}),
					);
				},
			}}
		/>,
	);
	return { done, calls, user: userEvent.setup() };
};

describe("two-factor management", () => {
	it.live("enrolls an authenticator app and shows the backup codes once confirmed", () =>
		Effect.gen(function* () {
			const { user, done, calls } = renderManagement(false);

			expect(screen.queryByLabelText("Password")).toBeNull();
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Set up authenticator app" })),
			);

			const qrCode = yield* Effect.promise(() =>
				screen.findByRole<HTMLImageElement>("img", { name: "QR code for your authenticator app" }),
			);
			expect(qrCode.src.startsWith("data:image/svg+xml;utf8,")).toBe(true);
			expect(screen.getByLabelText("Setup key").textContent).toBe("JBSWY3DPEHPK3PXP");
			expect(
				screen.getByRole("link", { name: "Open in authenticator app" }).getAttribute("href"),
			).toBe(totpURI);

			const codeInput = screen.getByLabelText("Authenticator code");
			yield* Effect.promise(() => user.type(codeInput, "000000"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Turn on two-factor authentication" })),
			);
			expect((yield* Effect.promise(() => screen.findByRole("alert"))).textContent).toBe(
				"Invalid code",
			);

			yield* Effect.promise(() => user.clear(codeInput));
			yield* Effect.promise(() => user.type(codeInput, "123456"));
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Turn on two-factor authentication" })),
			);

			const codes = yield* Effect.promise(() =>
				screen.findByRole("list", { name: "Backup codes" }),
			);
			expect(
				within(codes)
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual(["setup-code-1", "setup-code-2"]);
			expect(screen.getByText(/Two-factor authentication is on\./).textContent).toContain(
				"will not be shown again",
			);
			expect(calls).toEqual(["enable:correct-password", "confirm:000000", "confirm:123456"]);

			yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Done" })));
			expect(done).toEqual([true]);
		}),
	);

	it.live("keeps enrollment closed when the password is rejected", () =>
		Effect.gen(function* () {
			const { user } = renderManagement(false, "wrong-password");

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Set up authenticator app" })),
			);

			expect((yield* Effect.promise(() => screen.findByRole("alert"))).textContent).toBe(
				"Invalid password",
			);
			expect(screen.queryByRole("img")).toBeNull();
		}),
	);

	it.live("regenerates backup codes with the sign-in password after confirming", () =>
		Effect.gen(function* () {
			const { user, calls } = renderManagement(true);

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Regenerate backup codes" })),
			);
			expect(screen.queryByLabelText("Password")).toBeNull();
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Generate new codes" })),
			);

			const codes = yield* Effect.promise(() =>
				screen.findByRole("list", { name: "Backup codes" }),
			);
			expect(
				within(codes)
					.getAllByRole("listitem")
					.map((item) => item.textContent),
			).toEqual(["fresh-code-1", "fresh-code-2"]);
			expect(calls).toEqual(["regenerate:correct-password"]);
		}),
	);

	it.live("turns two-factor authentication off with the sign-in password after confirming", () =>
		Effect.gen(function* () {
			const { user, done, calls } = renderManagement(true);

			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Disable two-factor authentication" })),
			);
			expect(screen.queryByLabelText("Password")).toBeNull();
			yield* Effect.promise(() =>
				user.click(screen.getByRole("button", { name: "Turn off two-factor authentication" })),
			);

			yield* Effect.promise(() => screen.findByText("Two-factor authentication is off."));
			expect(calls).toEqual(["disable:correct-password"]);

			yield* Effect.promise(() => user.click(screen.getByRole("button", { name: "Done" })));
			expect(done).toEqual([true]);
		}),
	);
});
