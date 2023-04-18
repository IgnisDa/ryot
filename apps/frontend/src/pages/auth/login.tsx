import {
	type UserInput,
	LoginErrorVariant,
} from "@trackona/generated/graphql/backend/graphql";
import { LOGIN_USER } from "@trackona/graphql/backend/mutations";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Text, Input, Container, Button, Spacer } from "@nextui-org/react";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { gqlClient } from "@/lib/api";
import { useRouter } from "next/router";

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
			if (data.__typename === "LoginResponse") router.push("/");
		},
	});
	const { register, handleSubmit } = useForm<FormSchema>({
		resolver: zodResolver(formSchema),
	});
	const onSubmit: SubmitHandler<FormSchema> = ({ username, password }) => {
		loginUser.mutate({ username, password });
	};

	return (
		<Container
			css={{ marginBottom: "auto", marginTop: "auto" }}
			as="form"
			xs
			onSubmit={handleSubmit(onSubmit)}
		>
			<Input
				label="Username"
				css={{ width: "100%" }}
				{...register("username")}
			/>
			<Spacer y={0.5} />
			<Input.Password
				label="Password"
				css={{ width: "100%" }}
				{...register("password")}
			/>
			<Spacer y={1} />
			{loginUser.data && loginUser.data.__typename === "LoginError" && (
				<>
					<Text color="red">
						{((variant: LoginErrorVariant) => {
							switch (variant) {
								case LoginErrorVariant.CredentialsMismatch:
									return "The password provided was incorrect";
								case LoginErrorVariant.UsernameDoesNotExist:
									return "The given username does not exist";
							}
						})(loginUser.data.error)}
					</Text>
					<Spacer y={1} />
				</>
			)}
			<Button
				css={{ width: "100%" }}
				type="submit"
				disabled={loginUser.isLoading}
			>
				Login
			</Button>
		</Container>
	);
}
