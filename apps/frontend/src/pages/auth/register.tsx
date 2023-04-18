import { Input, Container, Button, Spacer } from "@nextui-org/react";

export default function Page() {
	return (
		<Container css={{ marginBottom: "auto", marginTop: "auto" }} as="form" xs>
			<Input label="Username" css={{ width: "100%" }} />
			<Spacer y={0.5} />
			<Input.Password label="Password" css={{ width: "100%" }} />
			<Spacer y={0.5} />
			<Input.Password label="Confirm password" css={{ width: "100%" }} />
			<Spacer y={1} />
			<Button css={{ width: "100%" }}>Register</Button>
		</Container>
	);
}
