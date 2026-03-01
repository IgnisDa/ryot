import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthClient } from "@/hooks/auth";

export const Route = createFileRoute("/start")({ component: StartPage });

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const authModes = {
	login: {
		actionLabel: "Log In",
		title: "Welcome back",
		passwordAutoComplete: "current-password",
		subtitle: "Use your email and password to continue",
	},
	signup: {
		actionLabel: "Sign Up",
		title: "Create your account",
		passwordAutoComplete: "new-password",
		subtitle: "Use your email and password to sign up",
	},
} as const;

type AuthMode = keyof typeof authModes;

const getTextFromUnknown = (value: unknown) => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const getAuthErrorMessage = (value: unknown) => {
	if (!value || typeof value !== "object")
		return "Authentication failed. Please try again.";

	const asRecord = value as Record<string, unknown>;
	const message = getTextFromUnknown(asRecord.message);
	if (message) return message;

	const statusText = getTextFromUnknown(asRecord.statusText);
	if (statusText) return statusText;

	return "Authentication failed. Please try again.";
};

const getFieldErrorMessage = (errors: Array<unknown>) => {
	for (const entry of errors) {
		const message = getTextFromUnknown(entry);
		if (message) return message;

		if (!entry || typeof entry !== "object") continue;
		const nested = getTextFromUnknown((entry as { message?: unknown }).message);
		if (nested) return nested;
	}

	return null;
};

const getNameFromEmail = (email: string) => {
	const [localPart = ""] = email.split("@");
	const normalized = localPart.replace(/[._-]+/g, " ").trim();
	if (!normalized) return "New User";

	return normalized
		.split(/\s+/)
		.map((segment) => {
			if (!segment) return segment;
			return `${segment[0].toUpperCase()}${segment.slice(1)}`;
		})
		.join(" ");
};

const validateEmail = (value: string) => {
	const email = value.trim();
	if (!email) return "Email is required";
	if (!emailPattern.test(email)) return "Enter a valid email";
	return undefined;
};

const validatePassword = (value: string, mode: AuthMode) => {
	if (!value) return "Password is required";
	if (mode === "signup" && value.length < 8) {
		return "Password must be at least 8 characters";
	}
	return undefined;
};

function StartPage() {
	const authClient = useAuthClient();
	const navigate = Route.useNavigate();
	const [mode, setMode] = useState<AuthMode>("login");
	const [submitError, setSubmitError] = useState<string | null>(null);

	const authForm = useForm({
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			setSubmitError(null);

			const email = value.email.trim();
			const password = value.password;

			const response =
				mode === "login"
					? await authClient.signIn.email({ email, password })
					: await authClient.signUp.email({
							email,
							password,
							name: getNameFromEmail(email),
						});

			if (response.error) {
				setSubmitError(getAuthErrorMessage(response.error));
				return;
			}

			await navigate({ to: "/" });
		},
	});

	const modeContent = authModes[mode];
	const isLoginMode = mode === "login";
	const isSignupMode = mode === "signup";

	return (
		<div className="page-wrap px-4 py-10 md:py-14">
			<div className="mx-auto w-full max-w-xl rise-in">
				<Card className="island-shell rounded-xl border-border/80">
					<CardHeader className="space-y-2 pb-3">
						<CardTitle className="display-title text-3xl font-semibold">
							{modeContent.title}
						</CardTitle>
						<p className="text-muted-foreground text-sm">
							{modeContent.subtitle}
						</p>
					</CardHeader>
					<CardContent className="space-y-5">
						<div className="bg-muted/60 grid w-full grid-cols-2 rounded-md border border-border/70 p-1">
							<Button
								className="flex-1"
								type="button"
								onClick={() => {
									setMode("login");
									setSubmitError(null);
								}}
								variant={isLoginMode ? "default" : "ghost"}
							>
								Login
							</Button>
							<Button
								className="flex-1"
								type="button"
								onClick={() => {
									setMode("signup");
									setSubmitError(null);
								}}
								variant={isSignupMode ? "default" : "ghost"}
							>
								Sign Up
							</Button>
						</div>

						<form
							onSubmit={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void authForm.handleSubmit();
							}}
						>
							<div className="space-y-4">
								<authForm.Field
									name="email"
									validators={{
										onBlur: ({ value }) => validateEmail(value),
										onChange: ({ value }) => validateEmail(value),
									}}
								>
									{(field) => {
										const errorMessage = field.state.meta.isTouched
											? getFieldErrorMessage(field.state.meta.errors)
											: null;

										return (
											<div className="space-y-2">
												<Label htmlFor="email">Email</Label>
												<Input
													autoComplete="email"
													className="bg-background/65"
													id="email"
													type="email"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													placeholder="you@example.com"
												/>
												{errorMessage ? (
													<p className="text-destructive text-xs">
														{errorMessage}
													</p>
												) : null}
											</div>
										);
									}}
								</authForm.Field>

								<authForm.Field
									name="password"
									validators={{
										onBlur: ({ value }) => validatePassword(value, mode),
										onChange: ({ value }) => validatePassword(value, mode),
									}}
								>
									{(field) => {
										const errorMessage = field.state.meta.isTouched
											? getFieldErrorMessage(field.state.meta.errors)
											: null;

										return (
											<div className="space-y-2">
												<Label htmlFor="password">Password</Label>
												<Input
													className="bg-background/65"
													id="password"
													type="password"
													value={field.state.value}
													onBlur={field.handleBlur}
													autoComplete={modeContent.passwordAutoComplete}
													onChange={(event) =>
														field.handleChange(event.target.value)
													}
													placeholder="Enter your password"
												/>
												{errorMessage ? (
													<p className="text-destructive text-xs">
														{errorMessage}
													</p>
												) : null}
											</div>
										);
									}}
								</authForm.Field>

								{submitError ? (
									<p className="text-destructive text-xs">{submitError}</p>
								) : null}

								<authForm.Subscribe selector={(state) => state.isSubmitting}>
									{(isSubmitting) => (
										<Button
											className="w-full"
											type="submit"
											disabled={isSubmitting}
										>
											{isSubmitting
												? "Please wait..."
												: modeContent.actionLabel}
										</Button>
									)}
								</authForm.Subscribe>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
