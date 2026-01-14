import { Text } from "@react-email/components";
import Layout from "../layout";

const GenericEmail = () => (
	<Layout headingText="You have a message">
		<Text>{"{{ generic_message }}"}</Text>
	</Layout>
);

export default GenericEmail;
