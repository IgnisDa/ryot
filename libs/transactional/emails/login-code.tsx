import { Text } from "@react-email/components";
import Layout from "../layout";

type LoginCodeEmailProps = {
	code: string;
};

const subject = "Login request for Ryot";

const LoginCodeEmail = (props: LoginCodeEmailProps) => (
	<Layout headingText={subject}>
		<Text>
			Your login code for Ryot is <strong>{props.code}</strong>. Please use this
			code to login to your account.
		</Text>
	</Layout>
);

LoginCodeEmail.subject = subject;

export default LoginCodeEmail;
