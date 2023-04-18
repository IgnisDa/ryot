import {
	type UserInput,
	LoginErrorVariant,
} from "@trackona/generated/graphql/backend/graphql";
import { LOGIN_USER } from "@trackona/graphql/backend/mutations";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { gqlClient } from "@/lib/api";
import { useRouter } from "next/router";
import { Box, Button, PasswordInput, TextInput } from "@mantine/core";
import { match } from "ts-pattern";
import { notifications } from "@mantine/notifications";

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
	const { register, handleSubmit } = useForm<FormSchema>({
		resolver: zodResolver(formSchema),
	});
	const onSubmit: SubmitHandler<FormSchema> = ({ username, password }) => {
		loginUser.mutate({ username, password });
	};

	return (
		<Box
			component="form"
			my={"auto"}
			mx={"auto"}
			onSubmit={handleSubmit(onSubmit)}
			sx={(t) => ({
				width: "80%",
				[t.fn.largerThan("sm")]: { width: "60%" },
				[t.fn.largerThan("md")]: { width: "50%" },
				[t.fn.largerThan("lg")]: { width: "40%" },
				[t.fn.largerThan("xl")]: { width: "30%" },
			})}
		>
			<TextInput label="Username" {...register("username")} />
			<PasswordInput label="Password" mt="md" {...register("password")} />
			<Button mt="md" type="submit" loading={loginUser.isLoading} w="100%">
				Login
			</Button>
		</Box>
	);
}
