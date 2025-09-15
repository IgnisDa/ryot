import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod/v4";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import {
	Alert,
	Anchor,
	Button,
	Divider,
	PasswordInput,
	Stack,
	TextInput,
} from "@mantine/core";
import {
	GetOidcRedirectUrlDocument,
	LoginErrorVariant,
	LoginUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getActionIntent,
	parseSearchQuery,
	processSubmission,
	startCase,
	zodBoolAsString,
	zodNumAsString,
} from "@ryot/ts-utils";
import { IconAt } from "@tabler/icons-react";
import { Form, Link, data, redirect, useLoaderData } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { passwordConfirmationSchema } from "~/lib/shared/validation";
import {
	createToastHeaders,
	getCookiesForApplication,
	getCoreDetails,
	redirectWithToast,
	serverGqlService,
	twoFactorSessionStorage,
} from "~/lib/utilities.server";
import type { Route } from "./+types/auth";

const searchParamsSchema = z.object({
	autoOidcLaunch: zodBoolAsString.optional(),
	intent: z.enum(["login", "register"]).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema> &
	Record<string, string>;

const getOidcRedirectUrl = () =>
	serverGqlService
		.request(GetOidcRedirectUrlDocument)
		.then(({ getOidcRedirectUrl }) => getOidcRedirectUrl);

export const loader = async ({ request }: Route.LoaderArgs) => {
	const query = parseSearchQuery(request, searchParamsSchema);
	const [coreDetails] = await Promise.all([getCoreDetails()]);
	if (
		(coreDetails.oidcEnabled || true) &&
		coreDetails.localAuthDisabled &&
		query.autoOidcLaunch === true
	) {
		const url = await getOidcRedirectUrl();
		return redirect(url);
	}
	return {
		intent: query.intent || "login",
		oidcEnabled: coreDetails.oidcEnabled,
		signupAllowed: coreDetails.signupAllowed,
		localAuthDisabled: coreDetails.localAuthDisabled,
		tokenValidForDays: coreDetails.tokenValidForDays,
		oidcButtonLabel: coreDetails.frontend.oidcButtonLabel,
	};
};

export const meta = () => [{ title: "Authentication | Ryot" }];

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("register", async () => {
			const submission = parseWithZod(formData, {
				schema: registerSchema,
			});
			if (submission.status !== "success")
				return data({} as const, {
					headers: await createToastHeaders({
						type: "error",
						message:
							submission.error?.password?.at(0) ||
							submission.error?.confirm?.at(0) ||
							"Invalid form data",
					}),
				});
			const { registerUser } = await serverGqlService.request(
				RegisterUserDocument,
				{
					input: {
						data: {
							password: {
								password: submission.value.password,
								username: submission.value.username,
							},
						},
					},
				},
			);
			if (registerUser.__typename === "RegisterError") {
				const message = match(registerUser.error)
					.with(RegisterErrorVariant.Disabled, () => "Registration is disabled")
					.with(
						RegisterErrorVariant.IdentifierAlreadyExists,
						() => "This username already exists",
					)
					.exhaustive();
				return data({} as const, {
					headers: await createToastHeaders({ message, type: "error" }),
				});
			}
			return await redirectWithToast($path("/auth"), {
				type: "success",
				message: "Please login with your new credentials",
			});
		})
		.with("login", async () => {
			const submission = processSubmission(formData, loginSchema);
			const { loginUser } = await serverGqlService.request(LoginUserDocument, {
				input: {
					password: {
						password: submission.password,
						username: submission.username,
					},
				},
			});
			if (loginUser.__typename === "ApiKeyResponse") {
				const headers = await getCookiesForApplication(loginUser.apiKey);
				return redirect($path("/"), { headers });
			}
			if (loginUser.__typename === "StringIdObject") {
				const session = await twoFactorSessionStorage.getSession();
				session.set("userId", loginUser.id);
				const twoFactorCookie =
					await twoFactorSessionStorage.commitSession(session);
				return redirect($path("/two-factor"), {
					headers: new Headers({ "set-cookie": twoFactorCookie }),
				});
			}
			const message = match(loginUser.error)
				.with(
					LoginErrorVariant.CredentialsMismatch,
					LoginErrorVariant.UsernameDoesNotExist,
					() => "The credentials provided were incorrect",
				)
				.with(
					LoginErrorVariant.AccountDisabled,
					() => "This account has been disabled. Please contact support.",
				)
				.with(
					LoginErrorVariant.IncorrectProviderChosen,
					() => "The provider chosen was incorrect",
				)
				.exhaustive();
			return data({} as const, {
				headers: await createToastHeaders({ message, type: "error" }),
			});
		})
		.with("getOidcRedirectUrl", async () => {
			const url = await getOidcRedirectUrl();
			return redirect(url);
		})
		.run();
};

const registerSchema = passwordConfirmationSchema.safeExtend({
	username: z.string(),
});

const loginSchema = z.object({
	username: z.string(),
	password: z.string(),
	tokenValidForDays: zodNumAsString,
});

export default function Page() {
	const [form, fields] = useForm({});
	const loaderData = useLoaderData<typeof loader>();
	const [parent] = useAutoAnimate();
	const intent = loaderData.intent;

	return (
		<Stack
			m="auto"
			w={{ base: "80%", sm: "60%", md: "50%", lg: "40%", xl: "30%" }}
		>
			{loaderData.localAuthDisabled && !loaderData.oidcEnabled ? (
				<Alert title="Authentication disabled" color="red">
					Both local authentication and OpenID Connect are disabled. Please
					contact the administrator.
				</Alert>
			) : null}
			{!loaderData.localAuthDisabled ? (
				<Form
					method="POST"
					action={withQuery(".", { intent })}
					{...getFormProps(form)}
					ref={parent}
				>
					<input
						type="hidden"
						name="tokenValidForDays"
						defaultValue={loaderData.tokenValidForDays}
					/>
					<TextInput
						{...getInputProps(fields.username, { type: "text" })}
						label="Username"
						autoFocus
						required
						error={fields.username.errors?.[0]}
					/>
					<PasswordInput
						label="Password"
						{...getInputProps(fields.password, { type: "password" })}
						mt="md"
						required
						error={fields.password.errors?.[0]}
					/>
					{intent === "register" ? (
						<PasswordInput
							label="Confirm password"
							mt="md"
							{...getInputProps(fields.confirm, { type: "password" })}
							required
							error={fields.confirm.errors?.[0]}
						/>
					) : null}
					<Button id="submit-button" mt="md" type="submit" w="100%">
						{startCase(intent)}
					</Button>
				</Form>
			) : null}
			{loaderData.oidcEnabled ? (
				<>
					{!loaderData.localAuthDisabled ? <Divider label="OR" /> : null}
					<Form
						replace
						method="POST"
						action={withQuery(".", { intent: "getOidcRedirectUrl" })}
					>
						<Button
							variant="outline"
							color="gray"
							w="100%"
							type="submit"
							leftSection={<IconAt size={16} />}
						>
							{loaderData.oidcButtonLabel}
						</Button>
					</Form>
				</>
			) : null}
			{loaderData.signupAllowed && !loaderData.localAuthDisabled ? (
				<Anchor
					ta="right"
					component={Link}
					to={withQuery(".", {
						intent: intent === "login" ? "register" : "login",
					})}
				>
					{
						{
							login: "Create a new account",
							register: "Already have an account",
						}[intent]
					}
					?
				</Anchor>
			) : null}
		</Stack>
	);
}
