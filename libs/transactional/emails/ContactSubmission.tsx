import { Text } from "@react-email/components";
import Layout from "../components/Layout";

type ContactSubmissionEmailProps = {
	message: string;
	ticketNumber: number;
};

const subject = "Query regarding Ryot";

const ContactSubmissionEmail = (props: ContactSubmissionEmailProps) => (
	<Layout headingText={subject}>
		<Text>
			[{props.ticketNumber}] Your contact submission has been received.
			<br />
			Message: <strong>{props.message}</strong>
			<br />
			Thank you for contacting us. We will get back to you as soon as possible.
		</Text>
	</Layout>
);

ContactSubmissionEmail.subject = subject;

export default ContactSubmissionEmail;
