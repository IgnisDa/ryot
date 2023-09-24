import { APP_ROUTES } from "@/lib/constants";
import { useCoreDetails, useEnabledCoreFeatures } from "@/lib/hooks/graphql";
import { gqlClient } from "@/lib/services/api";
import { Anchor, Box, Button, PasswordInput, TextInput } from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import {
	LoginErrorVariant,
	LoginUserDocument,
	type UserInput,
} from "@ryot/generated/graphql/backend/graphql";
import { useMutation } from "@tanstack/react-query";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { match } from "ts-pattern";
import { z } from "zod";

const formSchema = z.object({
	username: z.string(),
	password: z.string(),
	honeypot: z.string().length(0).optional(),
});
type FormSchema = z.infer<typeof formSchema>;

export default function Page() {
	const router = useRouter();
	const coreDetails = useCoreDetails();
	const enabledFeatures = useEnabledCoreFeatures();
	const loginUser = useMutation({
		mutationFn: async (input: UserInput) => {
			const { loginUser } = await gqlClient.request(LoginUserDocument, {
				input,
			});
			return loginUser;
		},
		onSuccess: (data) => {
			if (data.__typename === "LoginResponse") {
				router.push(APP_ROUTES.dashboard);
				return;
			} else {
				const message = match(data.error)
					.with(
						LoginErrorVariant.CredentialsMismatch,
						() => "The password provided was incorrect",
					)
					.with(
						LoginErrorVariant.UsernameDoesNotExist,
						() => "The username provided does not exist",
					)
					.exhaustive();
				notifications.show({
					title: "Error in login",
					message,
					color: "red",
				});
			}
		},
	});
	const form = useForm<FormSchema>({
		validate: zodResolver(formSchema),
	});

	useEffect(() => {
		if (coreDetails.data?.defaultCredentials)
			form.setValues({ password: "demo-password", username: "demo" });
	}, [coreDetails.data]);

	return (
		<>
			<Head>
				<title>Login | Ryot</title>
			</Head>
			<Box
				component="form"
				my={"auto"}
				mx={"auto"}
				onSubmit={form.onSubmit((values) => {
					loginUser.mutate(values);
				})}
				sx={(t) => ({
					width: "80%",
					[t.fn.largerThan("sm")]: { width: "60%" },
					[t.fn.largerThan("md")]: { width: "50%" },
					[t.fn.largerThan("lg")]: { width: "40%" },
					[t.fn.largerThan("xl")]: { width: "30%" },
				})}
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
				<input
					style={{ display: "none" }}
					{...form.getInputProps("honeypot")}
				/>
				<Button mt="md" type="submit" loading={loginUser.isLoading} w="100%">
					Login
				</Button>
				{enabledFeatures.data?.signupAllowed ? (
					<Box mt="lg" style={{ textAlign: "right" }}>
						Need an account? Register{" "}
						<Link href={APP_ROUTES.auth.register} passHref legacyBehavior>
							<Anchor>here</Anchor>
						</Link>
						.
					</Box>
				) : undefined}
			</Box>
		</>
	);
}
