import { Text } from "@react-email/components";
import Layout from "../layout";

type ContactSubmissionEmailProps = {
	message: string;
	ticketNumber: number;
};

const subject = "Query regarding Ryot";

const ContactSubmissionEmail = (props: ContactSubmissionEmailProps) => (
	<Layout headingText={subject}>
		<Text>
			Your contact submission has been received. Ticket number:{" "}
			<strong>{props.ticketNumber}</strong>
			<br />
			Message: <strong>{props.message}</strong>
			<br />
			Thank you for contacting us. We will get back to you as soon as possible.
		</Text>
	</Layout>
);

ContactSubmissionEmail.subject = subject;

export default ContactSubmissionEmail;
