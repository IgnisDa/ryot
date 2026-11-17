import { Text } from "react-email";

import Layout from "../layout";

type LoginCodeEmailProps = { code: string };

const subject = "Login request for Ryot";

const LoginCodeEmail = (props: LoginCodeEmailProps) => (
	<Layout lang="en" dir="ltr" headingText={subject} previewText="Message from Ryot">
		<Text>
			Your login code for Ryot is <strong>{props.code}</strong>. Please use this code to login to
			your account.
		</Text>
	</Layout>
);

LoginCodeEmail.subject = subject;

export default LoginCodeEmail;
