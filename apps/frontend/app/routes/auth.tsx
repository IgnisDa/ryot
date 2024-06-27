import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { $path } from "@ignisda/remix-routes";
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
	redirect,
	unstable_defineAction,
	unstable_defineLoader,
} from "@remix-run/node";
import {
	Form,
	Link,
	type MetaArgs_SingleFetch,
	useLoaderData,
	useSearchParams,
} from "@remix-run/react";
import {
	CoreDetailsDocument,
	GetOidcRedirectUrlDocument,
	LoginErrorVariant,
	LoginUserDocument,
	RegisterErrorVariant,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { startCase } from "@ryot/ts-utils";
import { IconAt } from "@tabler/icons-react";
import { serialize } from "cookie";
import { namedAction } from "remix-utils/named-action";
import { safeRedirect } from "remix-utils/safe-redirect";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { AUTH_COOKIE_NAME, redirectToQueryParam } from "~/lib/generals";
import {
	combineHeaders,
	createToastHeaders,
	getCookiesForApplication,
	getCoreEnabledFeatures,
	getIsAuthenticated,
	processSubmission,
	redirectWithToast,
	serverGqlService,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	intent: z.enum(["login", "register"]).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema> &
	Record<string, string>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [isAuthenticated, _] = await getIsAuthenticated(request);
	if (isAuthenticated)
		throw await redirectWithToast($path("/"), {
			message: "You were already logged in",
		});
	const [enabledFeatures, { coreDetails }] = await Promise.all([
		getCoreEnabledFeatures(),
		serverGqlService.request(CoreDetailsDocument),
	]);
	return {
		intent: query.intent || "login",
		oidcEnabled: coreDetails.oidcEnabled,
		localAuthDisabled: coreDetails.localAuthDisabled,
		tokenValidForDays: coreDetails.tokenValidForDays,
		signupAllowed: enabledFeatures.signupAllowed,
	};
});

export const meta = (_args: MetaArgs_SingleFetch<typeof loader>) => [
	{ title: "Authentication | Ryot" },
];

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.formData();
	return namedAction(request, {
		register: async () => {
			const submission = parseWithZod(formData, {
				schema: registerSchema,
			});
			if (submission.status !== "success")
				return Response.json({} as const, {
					status: 400,
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
						password: {
							password: submission.value.password,
							username: submission.value.username,
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
				return Response.json({} as const, {
					status: 400,
					headers: await createToastHeaders({ message, type: "error" }),
				});
			}
			return await redirectWithToast($path("/auth"), {
				type: "success",
				message: "Please login with your new credentials",
			});
		},
		login: async () => {
			const submission = processSubmission(formData, loginSchema);
			const { loginUser } = await serverGqlService.request(LoginUserDocument, {
				input: {
					password: {
						password: submission.password,
						username: submission.username,
					},
				},
			});
			if (loginUser.__typename === "LoginResponse") {
				let redirectUrl = $path("/");
				if (submission[redirectToQueryParam])
					redirectUrl = safeRedirect(submission[redirectToQueryParam]);
				const cookies = await getCookiesForApplication(loginUser.apiKey);
				const options = { maxAge: submission.tokenValidForDays * 24 * 60 * 60 };
				return redirect(redirectUrl, {
					headers: combineHeaders(
						{
							"set-cookie": serialize(
								AUTH_COOKIE_NAME,
								loginUser.apiKey,
								options,
							),
						},
						cookies,
					),
				});
			}
			const message = match(loginUser.error)
				.with(
					LoginErrorVariant.CredentialsMismatch,
					LoginErrorVariant.UsernameDoesNotExist,
					() => "The credentials provided were incorrect",
				)
				.with(
					LoginErrorVariant.IncorrectProviderChosen,
					() => "The provider chosen was incorrect",
				)
				.exhaustive();
			return Response.json({} as const, {
				headers: await createToastHeaders({ message, type: "error" }),
			});
		},
		getOauthRedirectUrl: async () => {
			const { getOidcRedirectUrl } = await serverGqlService.request(
				GetOidcRedirectUrlDocument,
			);
			return redirect(getOidcRedirectUrl);
		},
	});
});

const registerSchema = z
	.object({
		username: z.string(),
		password: z
			.string()
			.min(8, "Password should be at least 8 characters long"),
		confirm: z.string(),
	})
	.refine((data) => data.password === data.confirm, {
		message: "Passwords do not match",
		path: ["confirm"],
	});

const loginSchema = z.object({
	username: z.string(),
	password: z.string(),
	[redirectToQueryParam]: z.string().optional(),
	tokenValidForDays: zx.NumAsString,
});

export default function Page() {
	const [form, fields] = useForm({});
	const loaderData = useLoaderData<typeof loader>();
	const [parent] = useAutoAnimate();
	const [searchParams] = useSearchParams();
	const redirectValue = searchParams.get(redirectToQueryParam);
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
					method="post"
					action={withQuery(".", { intent })}
					{...getFormProps(form)}
					ref={parent}
				>
					<input
						type="hidden"
						name="tokenValidForDays"
						defaultValue={loaderData.tokenValidForDays}
					/>
					{redirectValue ? (
						<input
							type="hidden"
							name={redirectToQueryParam}
							defaultValue={redirectValue}
						/>
					) : null}
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
					<Form method="post" action="?intent=getOauthRedirectUrl" replace>
						<Button
							variant="outline"
							color="gray"
							w="100%"
							type="submit"
							leftSection={<IconAt size={16} />}
						>
							Continue with OpenID Connect
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
