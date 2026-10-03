import { Text } from "@react-email/components";

import Layout from "../layout";

type GenericEmailProps = { message: string };

const GenericEmail = (props: GenericEmailProps = { message: "" }) => (
	<Layout headingText="You have a message">
		<Text>{props.message}</Text>
	</Layout>
);

export default GenericEmail;
