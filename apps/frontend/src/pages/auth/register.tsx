import { Input, Container, Row, Button } from "@nextui-org/react";

export default function Page() {
	return (
		<Container className="my-auto" as="form">
			<Row>
				<Input label="Username" />
			</Row>
			<Row>
				<Input.Password label="Password" />
			</Row>
			<Row>
				<Input.Password label="Confirm password" />
			</Row>
			<Button color="primary">Register</Button>
		</Container>
	);
}
