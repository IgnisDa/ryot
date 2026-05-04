import { Center, Paper, Stack, Tabs, Text, Title } from "@mantine/core";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { getNameFromEmail } from "~/features/authentication/model";
import { useApiClient } from "~/hooks/api";
import { useAppForm } from "~/hooks/forms";
import { authClient } from "~/lib/auth";

const searchSchema = z.object({
	redirect: z.string().optional(),
});

export const Route = createFileRoute("/start")({
	component: StartPage,
	validateSearch: searchSchema,
	beforeLoad: async ({ search }) => {
		const session = await authClient.getSession();
		if (session.data) {
			throw redirect({ to: search.redirect || "/" });
		}
	},
});

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

const schema = z.object({
	email: z.email().min(1, "Email is required"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

function StartPage() {
	const search = Route.useSearch();
	const apiClient = useApiClient();
	const navigate = Route.useNavigate();
	const [mode, setMode] = useState<AuthMode>("login");
	const [submitError, setSubmitError] = useState<string | null>(null);
	const signupMutation = apiClient.useMutation("post", "/authentication/email", {
		onError: (error) => setSubmitError(error.error.message),
	});

	const authForm = useAppForm({
		validators: { onChange: schema },
		defaultValues: { email: "", password: "" },
		onSubmit: async ({ value }) => {
			setSubmitError(null);

			const email = value.email.trim();
			const password = value.password;

			if (mode === "signup") {
				try {
					await signupMutation.mutateAsync({
						body: { email, password, name: getNameFromEmail(email) },
					});
				} catch {
					return;
				}

				authForm.setFieldValue("password", "");
				setMode("login");
				return;
			}

			const response = await authClient.signIn.email({
				email,
				password,
			});

			if (response.error) {
				setSubmitError(response.error.message || "An unknown error occurred");
				return;
			}

			await navigate({ to: search.redirect || "/" });
		},
	});

	const modeContent = authModes[mode];

	const handleModeChange = (value: string | null) => {
		if (value !== "login" && value !== "signup") {
			return;
		}
		setMode(value);
		setSubmitError(null);
	};

	return (
		<Center p="xl" pt={{ base: 40, md: 56 }}>
			<Paper shadow="sm" radius="md" p="xl" maw={600} w="100%">
				<Stack gap="lg">
					<Stack gap="xs">
						<Title order={1} size="h2">
							{modeContent.title}
						</Title>
						<Text c="dimmed" size="sm">
							{modeContent.subtitle}
						</Text>
					</Stack>

					<Tabs value={mode} onChange={handleModeChange}>
						<Tabs.List grow>
							<Tabs.Tab value="login">Login</Tabs.Tab>
							<Tabs.Tab value="signup">Sign Up</Tabs.Tab>
						</Tabs.List>
					</Tabs>

					<form
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void authForm.handleSubmit();
						}}
					>
						<authForm.AppForm>
							<Stack gap="md">
								<authForm.AppField name="email">
									{(field) => (
										<field.TextField
											type="email"
											label="Email"
											autoComplete="email"
											placeholder="you@example.com"
										/>
									)}
								</authForm.AppField>

								<authForm.AppField name="password">
									{(field) => (
										<>
											<field.TextField
												type="password"
												label="Password"
												placeholder="Enter your password"
												autoComplete={modeContent.passwordAutoComplete}
											/>

											{submitError ? (
												<Text c="red" size="xs">
													{submitError}
												</Text>
											) : null}
										</>
									)}
								</authForm.AppField>
								<authForm.SubmitButton
									fullWidth
									pendingLabel="Please wait..."
									label={modeContent.actionLabel}
								/>
							</Stack>
						</authForm.AppForm>
					</form>
				</Stack>
			</Paper>
		</Center>
	);
}
