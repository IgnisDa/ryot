import { Input, Container, Button, Spacer } from "@nextui-org/react";

export default function Page() {
	return (
		<Container css={{ marginBottom: "auto", marginTop: "auto" }} as="form">
			<Input label="Username" />
			<Spacer y={0.5} />
			<Input.Password label="Password" />
			<Spacer y={0.5} />
			<Input.Password label="Confirm password" />
			<Spacer y={1} />
			<Button>Register</Button>
		</Container>
	);
}
