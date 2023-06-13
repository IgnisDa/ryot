import { ROUTES } from "@/lib/constants";
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
import { match } from "ts-pattern";
import { z } from "zod";

const formSchema = z.object({
	username: z.string(),
	password: z.string(),
});
type FormSchema = z.infer<typeof formSchema>;

export default function Page() {
	const router = useRouter();
	const loginUser = useMutation({
		mutationFn: async (input: UserInput) => {
			const { loginUser } = await gqlClient.request(LoginUserDocument, {
				input,
			});
			return loginUser;
		},
		onSuccess: (data) => {
			if (data.__typename === "LoginResponse") {
				router.push(ROUTES.dashboard);
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
					.with(
						LoginErrorVariant.MutexError,
						() => "There was an error reading the user database",
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
	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });

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
				<Button mt="md" type="submit" loading={loginUser.isLoading} w="100%">
					Login
				</Button>
				<Box mt="lg" style={{ textAlign: "right" }}>
					Need an account? Register{" "}
					<Link href={ROUTES.auth.register} passHref legacyBehavior>
						<Anchor>here</Anchor>
					</Link>
					.
				</Box>
			</Box>
		</>
	);
}
