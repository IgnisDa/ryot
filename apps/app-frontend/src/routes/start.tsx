import { useForm } from "@tanstack/react-form";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, Container, Text, TextField, View } from "reshaped";
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
		<div
			style={{
				minHeight: "100vh",
				background: "linear-gradient(130deg, #f5f5f5 0%, #eef5ff 100%)",
			}}
		>
			<Container width="800px" padding={8}>
				<View
					align="center"
					justify="center"
					paddingTop={18}
					paddingBottom={18}
				>
					<View.Item columns={{ s: 12, m: 8 }}>
						<Card padding={7}>
							<View gap={6}>
								<View gap={2}>
									<Text as="h1" variant="title-4" weight="medium">
										{modeContent.title}
									</Text>
									<Text color="neutral-faded">{modeContent.subtitle}</Text>
								</View>

								<View
									gap={2}
									padding={1}
									direction="row"
									backgroundColor="neutral-faded"
									borderRadius="medium"
								>
									<Button
										fullWidth
										type="button"
										variant={isLoginMode ? "solid" : "faded"}
										onClick={() => {
											setMode("login");
											setSubmitError(null);
										}}
									>
										Login
									</Button>
									<Button
										fullWidth
										type="button"
										variant={isSignupMode ? "solid" : "faded"}
										onClick={() => {
											setMode("signup");
											setSubmitError(null);
										}}
									>
										Sign Up
									</Button>
								</View>

								<form
									onSubmit={(event) => {
										event.preventDefault();
										event.stopPropagation();
										void authForm.handleSubmit();
									}}
								>
									<View gap={4}>
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
													<View gap={2}>
														<TextField
															name="Email"
															value={field.state.value}
															onBlur={field.handleBlur}
															placeholder="you@example.com"
															onChange={(event) =>
																field.handleChange(event.value)
															}
															inputAttributes={{
																autoComplete: "email",
																type: "email",
															}}
														/>
														{errorMessage ? (
															<Text color="critical" variant="caption-1">
																{errorMessage}
															</Text>
														) : null}
													</View>
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
													<View gap={2}>
														<TextField
															name="Password"
															value={field.state.value}
															onBlur={field.handleBlur}
															placeholder="Enter your password"
															onChange={(event) =>
																field.handleChange(event.value)
															}
															inputAttributes={{
																autoComplete: modeContent.passwordAutoComplete,
																type: "password",
															}}
														/>
														{errorMessage ? (
															<Text color="critical" variant="caption-1">
																{errorMessage}
															</Text>
														) : null}
													</View>
												);
											}}
										</authForm.Field>

										{submitError ? (
											<Text color="critical" variant="caption-1">
												{submitError}
											</Text>
										) : null}

										<authForm.Subscribe
											selector={(state) => state.isSubmitting}
										>
											{(isSubmitting) => (
												<Button
													fullWidth
													type="submit"
													loading={isSubmitting}
													disabled={isSubmitting}
												>
													{modeContent.actionLabel}
												</Button>
											)}
										</authForm.Subscribe>
									</View>
								</form>
							</View>
						</Card>
					</View.Item>
				</View>
			</Container>
		</div>
	);
}
