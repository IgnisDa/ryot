import { Box, Container } from "@mantine/core";
import { LoaderFunctionArgs, MetaFunction, json } from "@remix-run/node";

export const loader = async (_args: LoaderFunctionArgs) => {
	return json({});
};

export const meta: MetaFunction = () => {
	return [{ title: "Imports and Exports | Ryot" }];
};

export default function Page() {
	return (
		<Container>
			<Box>Hello world!</Box>
		</Container>
	);
}
