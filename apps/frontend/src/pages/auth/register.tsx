import {
	type UserInput,
	RegisterErrorVariant,
} from "@trackona/generated/graphql/backend/graphql";
import { REGISTER_USER } from "@trackona/graphql/backend/mutations";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Text, Input, Container, Button, Spacer } from "@nextui-org/react";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { gqlClient } from "@/lib/api";

const formSchema = z
	.object({
		username: z.string(),
		password: z.string(),
		confirm: z.string(),
	})
	.refine((data) => data.password === data.confirm, {
		message: "Passwords do not match",
		path: ["confirm"],
	});
type FormSchema = z.infer<typeof formSchema>;

export default function Page() {
	const registerUser = useMutation(async (input: UserInput) => {
		const { registerUser } = await gqlClient.request(REGISTER_USER, { input });
		return registerUser;
	});
	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<FormSchema>({ resolver: zodResolver(formSchema) });
	const onSubmit: SubmitHandler<FormSchema> = ({ username, password }) => {
		registerUser.mutate({ username, password });
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
			{registerUser.data &&
				registerUser.data.__typename === "RegisterError" && (
					<Text color="red">
						{registerUser.data.error ===
						RegisterErrorVariant.UsernameAlreadyExists
							? "A user with this username already exists"
							: ""}
					</Text>
				)}
			<Spacer y={0.5} />
			<Input.Password
				label="Password"
				css={{ width: "100%" }}
				{...register("password")}
			/>
			<Spacer y={0.5} />
			<Input.Password
				label="Confirm password"
				css={{ width: "100%" }}
				{...register("confirm")}
			/>
			{errors.confirm && <Text color="red">{errors.confirm.message}</Text>}
			<Spacer y={1} />
			<Button
				css={{ width: "100%" }}
				type="submit"
				disabled={registerUser.isLoading}
			>
				Register
			</Button>
		</Container>
	);
}
