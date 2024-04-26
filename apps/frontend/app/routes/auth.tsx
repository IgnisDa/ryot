import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { parseWithZod } from "@conform-to/zod";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { $path } from "@ignisda/remix-routes";
import {
	Anchor,
	Box,
	Button,
	Divider,
	PasswordInput,
	Stack,
	TextInput,
} from "@mantine/core";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	type MetaFunction,
	json,
	redirect,
} from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
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
import { namedAction } from "remix-utils/named-action";
import { safeRedirect } from "remix-utils/safe-redirect";
import { match } from "ts-pattern";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { redirectToQueryParam } from "~/lib/generals";
import {
	authCookie,
	combineHeaders,
	createToastHeaders,
	getCookiesForApplication,
	getCoreEnabledFeatures,
	getIsAuthenticated,
	gqlClient,
	processSubmission,
	redirectWithToast,
} from "~/lib/utilities.server";
import classes from "~/styles/auth.module.css";

const searchParamsSchema = z.object({
	defaultForm: z.enum(["login", "register"]).optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema> &
	Record<string, string>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const [isAuthenticated, _] = await getIsAuthenticated(request);
	if (isAuthenticated)
		return redirectWithToast($path("/"), {
			message: "You were already logged in",
		});
	const [enabledFeatures, { coreDetails }] = await Promise.all([
		getCoreEnabledFeatures(),
		gqlClient.request(CoreDetailsDocument),
	]);
	return json({
		defaultForm: query.defaultForm || "login",
		oidcEnabled: coreDetails.oidcEnabled,
		tokenValidForDays: coreDetails.tokenValidForDays,
		signupAllowed: enabledFeatures.signupAllowed,
	});
};

export const meta: MetaFunction = () => [{ title: "Register | Ryot" }];

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.formData();
	return namedAction(request, {
		passwordRegister: async () => {
			const submission = parseWithZod(formData, {
				schema: passwordRegisterSchema,
			});
			if (submission.status !== "success")
				return json({} as const, {
					status: 400,
					headers: await createToastHeaders({
						type: "error",
						message:
							submission.error?.password?.at(0) ||
							submission.error?.confirm?.at(0) ||
							"Invalid form data",
					}),
				});
			const { registerUser } = await gqlClient.request(RegisterUserDocument, {
				input: {
					password: {
						password: submission.value.password,
						username: submission.value.username,
					},
				},
			});
			if (registerUser.__typename === "RegisterError") {
				const message = match(registerUser.error)
					.with(RegisterErrorVariant.Disabled, () => "Registration is disabled")
					.with(
						RegisterErrorVariant.IdentifierAlreadyExists,
						() => "This username already exists",
					)
					.exhaustive();
				return json({} as const, {
					status: 400,
					headers: await createToastHeaders({ message, type: "error" }),
				});
			}
			return json({} as const, {
				headers: await createToastHeaders({
					type: "success",
					message: "Please login with your new credentials",
				}),
			});
		},
		passwordLogin: async () => {
			const submission = processSubmission(formData, passwordLoginSchema);
			const { loginUser } = await gqlClient.request(LoginUserDocument, {
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
							"set-cookie": await authCookie.serialize(
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
			return json({} as const, {
				headers: await createToastHeaders({ message, type: "error" }),
			});
		},
		getOauthRedirectUrl: async () => {
			const { getOidcRedirectUrl } = await gqlClient.request(
				GetOidcRedirectUrlDocument,
			);
			return redirect(getOidcRedirectUrl);
		},
	});
};

const passwordRegisterSchema = z
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

const passwordLoginSchema = z.object({
	username: z.string(),
	password: z.string(),
	[redirectToQueryParam]: z.string().optional(),
	tokenValidForDays: zx.NumAsString,
});

export default function Page() {
	const [form, fields] = useForm({});
	const loaderData = useLoaderData<typeof loader>();
	const [parent] = useAutoAnimate();
	const defaultForm = loaderData.defaultForm;

	return (
		<Stack m="auto" className={classes.form}>
			<Form
				method="post"
				action={withQuery(".", {
					intent:
						defaultForm === "login" ? "passwordLogin" : "passwordRegister",
				})}
				{...getFormProps(form)}
				ref={parent}
			>
				<input
					type="hidden"
					name="tokenValidForDays"
					value={loaderData.tokenValidForDays}
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
				{defaultForm === "register" ? (
					<PasswordInput
						label="Confirm password"
						mt="md"
						{...getInputProps(fields.confirm, { type: "password" })}
						required
						error={fields.confirm.errors?.[0]}
					/>
				) : null}
				<Button id="submit-button" mt="md" type="submit" w="100%">
					{startCase(defaultForm)}
				</Button>
			</Form>
			{loaderData.oidcEnabled ? (
				<>
					<Divider label="OR" />
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
			{loaderData.signupAllowed ? (
				<Box mt={loaderData.oidcEnabled ? "xl" : undefined} ta="right">
					<Anchor
						component={Link}
						to={withQuery(".", {
							defaultForm: defaultForm === "login" ? "register" : "login",
						})}
					>
						{
							{
								login: "Create a new account",
								register: "Already have an account",
							}[defaultForm]
						}
						?
					</Anchor>
				</Box>
			) : null}
		</Stack>
	);
}
