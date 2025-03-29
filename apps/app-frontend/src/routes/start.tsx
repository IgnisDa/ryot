import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthClient } from "@/hooks/auth";
import { useAppForm } from "@/hooks/forms";

export const Route = createFileRoute("/start")({
	component: StartPage,
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

const schema = z.object({
	email: z.email().min(1, "Email is required"),
	password: z.string().min(8, "Password must be at least 8 characters"),
});

function StartPage() {
	const authClient = useAuthClient();
	const navigate = Route.useNavigate();
	const [mode, setMode] = useState<AuthMode>("login");
	const [submitError, setSubmitError] = useState<string | null>(null);

	const authForm = useAppForm({
		validators: { onBlur: schema },
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
													<p className="text-destructive text-xs">
														{submitError}
													</p>
												) : null}
											</>
										)}
									</authForm.AppField>
									<authForm.SubmitButton
										className="w-full"
										pendingLabel="Please wait..."
										label={modeContent.actionLabel}
									/>
								</div>
							</authForm.AppForm>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
