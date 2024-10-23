import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
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
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaArgs,
	redirect,
} from "@remix-run/node";
import { Form, Link, useLoaderData, useSearchParams } from "@remix-run/react";
import {
	GetOidcRedirectUrlDocument,
	LatestUserSummaryDocument,
	LoginErrorVariant,
	LoginUserDocument,
	MediaLot,
	RegisterErrorVariant,
	RegisterUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getActionIntent, processSubmission, startCase } from "@ryot/ts-utils";
import { IconAt } from "@tabler/icons-react";
import { $path } from "remix-routes";
import { safeRedirect } from "remix-utils/safe-redirect";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { dayjsLib, redirectToQueryParam } from "~/lib/generals";
import {
	createToastHeaders,
	getAuthorizationCookie,
	getCachedCoreDetails,
	getCachedUserPreferences,
	getCookiesForApplication,
	redirectWithToast,
	serverGqlService,
	serverVariables,
} from "~/lib/utilities.server";

const searchParamsSchema = z.object({
	intent: z.enum(["login", "register"]).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema> &
	Record<string, string>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const isAuthenticated = !!getAuthorizationCookie(request);
	if (isAuthenticated) {
		const [userPreferences, { latestUserSummary }] = await Promise.all([
			getCachedUserPreferences(request),
			serverGqlService.authenticatedRequest(request, LatestUserSummaryDocument),
		]);
		if (
			latestUserSummary.totalMetadataCount === 0 &&
			userPreferences.featuresEnabled.media.enabled === true
		)
			throw await redirectWithToast(
				$path(
					"/media/:action/:lot",
					{ action: "search", lot: MediaLot.Movie },
					{ query: "avengers" },
				),
				{
					message:
						"Welcome to Ryot! Get started by adding a movie to your watchlist!",
					closeAfter: dayjsLib.duration(10, "second").asMilliseconds(),
				},
			);
		throw redirect($path("/"));
	}
	const [{ coreDetails }] = await Promise.all([getCachedCoreDetails()]);
	return {
		intent: query.intent || "login",
		oidcEnabled: coreDetails.oidcEnabled,
		oidcButtonLabel: serverVariables.FRONTEND_OIDC_BUTTON_LABEL,
		localAuthDisabled: coreDetails.localAuthDisabled,
		tokenValidForDays: coreDetails.tokenValidForDays,
		signupAllowed: coreDetails.signupAllowed,
	};
};

export const meta = (_args: MetaArgs<typeof loader>) => [
	{ title: "Authentication | Ryot" },
];

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("register", async () => {
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
				return Response.json({} as const, {
					status: 400,
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
			if (loginUser.__typename === "LoginResponse") {
				const headers = await getCookiesForApplication(loginUser.apiKey);
				if (submission[redirectToQueryParam])
					return redirect(safeRedirect(submission[redirectToQueryParam]), {
						headers,
					});
				return Response.json({}, { headers });
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
			return Response.json({} as const, {
				headers: await createToastHeaders({ message, type: "error" }),
			});
		})
		.with("getOidcRedirectUrl", async () => {
			const { getOidcRedirectUrl } = await serverGqlService.request(
				GetOidcRedirectUrlDocument,
			);
			return redirect(getOidcRedirectUrl);
		})
		.run();
};

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
