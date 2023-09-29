import { APP_ROUTES } from "@/lib/constants";
import { useEnabledCoreFeatures } from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import {
	Anchor,
	Box,
	Button,
	PasswordInput,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	RegisterErrorVariant,
	RegisterUserDocument,
	type UserInput,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { match } from "ts-pattern";
import { z } from "zod";
import classes from "./styles.module.css";

const formSchema = z
	.object({
		honeypot: z.string().length(0).optional(),
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
type FormSchema = z.infer<typeof formSchema>;

export default function Page() {
	const router = useRouter();
	const enabledFeatures = useEnabledCoreFeatures();
	const registerUser = useMutation({
		mutationFn: async (input: UserInput) => {
			const { registerUser } = await gqlClient.request(RegisterUserDocument, {
				input,
			});
			return registerUser;
		},
		onSuccess(data) {
			if (data.__typename === "RegisterError") {
				const message = match(data.error)
					.with(RegisterErrorVariant.Disabled, () => "Registration is disabled")
					.with(
						RegisterErrorVariant.UsernameAlreadyExists,
						() => "This username already exists",
					)
					.exhaustive();
				notifications.show({
					title: "Error with registration",
					message,
					color: "red",
				});
			} else {
				notifications.show({
					title: "Success",
					message: "Please login with your new credentials",
					color: "green",
				});
				router.push(APP_ROUTES.auth.login);
			}
		},
	});

	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });

	return (
		<>
			<Head>
				<title>Register | Ryot</title>
			</Head>
			<Box
				component="form"
				my={"auto"}
				mx={"auto"}
				onSubmit={form.onSubmit((values) => {
					registerUser.mutate({
						username: values.username,
						password: values.password,
					});
				})}
				className={classes.form}
			>
				<TextInput
					label="Username"
					{...form.getInputProps("username")}
					required
					autoFocus
				/>
				<PasswordInput
					label="Password"
					mt="md"
					{...form.getInputProps("password")}
					required
				/>
				<PasswordInput
					label="Confirm password"
					mt="md"
					{...form.getInputProps("confirm")}
					required
				/>
				<input
					style={{ display: "none" }}
					{...form.getInputProps("honeypot")}
				/>
				<Tooltip
					label="Sign ups are disabled on this instance"
					disabled={enabledFeatures.data?.signupAllowed}
				>
					<Button
						mt="md"
						type="submit"
						{...(!enabledFeatures.data?.signupAllowed
							? { "data-disabled": true }
							: {})}
						loading={registerUser.isLoading}
						className={classes.btn}
						w="100%"
					>
						Register
					</Button>
				</Tooltip>
				<Box mt="lg" style={{ textAlign: "right" }}>
					Already a member? Login{" "}
					<Link href={APP_ROUTES.auth.login} passHref legacyBehavior>
						<Anchor>here</Anchor>
					</Link>
					.
				</Box>
			</Box>
		</>
	);
}
