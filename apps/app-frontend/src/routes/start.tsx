import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthClient } from "@/hooks/auth";
import { useAppForm } from "@/hooks/forms";

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
	if (mode === "signup" && value.length < 8)
		return "Password must be at least 8 characters";
	return undefined;
};

function StartPage() {
	const authClient = useAuthClient();
	const navigate = Route.useNavigate();
	const [mode, setMode] = useState<AuthMode>("login");
	const [submitError, setSubmitError] = useState<string | null>(null);

	const authForm = useAppForm({
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
				setSubmitError(response.error.message || "An unknown error occurred");
				return;
			}

			await navigate({ to: "/" });
		},
	});

	const modeContent = authModes[mode];

	const handleModeChange = (value: string) => {
		if (value !== "login" && value !== "signup") return;
		setMode(value);
		setSubmitError(null);
	};

	return (
		<div className="page-wrap px-4 py-10 md:py-14">
			<div className="mx-auto w-full max-w-xl rise-in">
				<Card className="island-shell rounded-xl border-border/80">
					<CardHeader className="space-y-2 pb-3">
						<CardTitle className="text-3xl font-semibold">
							{modeContent.title}
						</CardTitle>
						<p className="text-muted-foreground text-sm">
							{modeContent.subtitle}
						</p>
					</CardHeader>
					<CardContent className="space-y-5">
						<Tabs value={mode} onValueChange={handleModeChange}>
							<TabsList className="grid w-full grid-cols-2 border border-border/70 bg-muted/60">
								<TabsTrigger value="login">Login</TabsTrigger>
								<TabsTrigger value="signup">Sign Up</TabsTrigger>
							</TabsList>
						</Tabs>

						<form
							onSubmit={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void authForm.handleSubmit();
							}}
						>
							<authForm.AppForm>
								<div className="space-y-4">
									<authForm.AppField
										name="email"
										validators={{
											onBlur: ({ value }) => validateEmail(value),
											onChange: ({ value }) => validateEmail(value),
										}}
									>
										{(field) => (
											<field.TextField
												type="email"
												label="Email"
												autoComplete="email"
												className="bg-background/65"
												placeholder="you@example.com"
												getErrorMessage={getFieldErrorMessage}
											/>
										)}
									</authForm.AppField>

									<authForm.AppField
										name="password"
										validators={{
											onBlur: ({ value }) => validatePassword(value, mode),
											onChange: ({ value }) => validatePassword(value, mode),
										}}
									>
										{(field) => (
											<>
												<field.TextField
													type="password"
													label="Password"
													className="bg-background/65"
													placeholder="Enter your password"
													getErrorMessage={getFieldErrorMessage}
													autoComplete={modeContent.passwordAutoComplete}
												/>

												{submitError ? (
													<p className="text-destructive text-xs">
														{submitError}
													</p>
												) : null}

												<authForm.SubmitButton
													className="w-full"
													label={modeContent.actionLabel}
													pendingLabel="Please wait..."
												/>
											</>
										)}
									</authForm.AppField>
								</div>
							</authForm.AppForm>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
