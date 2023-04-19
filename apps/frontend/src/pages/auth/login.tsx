import {
	type UserInput,
	LoginErrorVariant,
} from "@trackona/generated/graphql/backend/graphql";
import { LOGIN_USER } from "@trackona/graphql/backend/mutations";
import { zodResolver, useForm } from "@mantine/form";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { gqlClient } from "@/lib/services/api";
import { useRouter } from "next/router";
import { Anchor, Box, Button, PasswordInput, TextInput } from "@mantine/core";
import { match } from "ts-pattern";
import { notifications } from "@mantine/notifications";
import Link from "next/link";

const formSchema = z.object({
	username: z.string(),
	password: z.string(),
});
type FormSchema = z.infer<typeof formSchema>;

export default function Page() {
	const router = useRouter();
	const loginUser = useMutation({
		mutationFn: async (input: UserInput) => {
			const { loginUser } = await gqlClient.request(LOGIN_USER, { input });
			return loginUser;
		},
		onSuccess: (data) => {
			if (data.__typename === "LoginResponse") {
				router.push("/");
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
	const form = useForm<FormSchema>({ validate: zodResolver(formSchema) });

	return (
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
				<Link href="/auth/register" passHref legacyBehavior>
					<Anchor>here</Anchor>
				</Link>
				.
			</Box>
		</Box>
	);
}
