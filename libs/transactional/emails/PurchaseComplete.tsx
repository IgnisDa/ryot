import { Link, Text } from "@react-email/components";
import { isString } from "@ryot/ts-utils";
import Layout from "../components/Layout";

const applicationLink = "https://app.ryot.io";

export type PurchaseCompleteEmailProps = {
	planType: string;
	renewOn?: string;
	details:
		| { __typename: "self_hosted"; key: string }
		| {
				__typename: "cloud";
				auth: string | { username: string; password: string };
		  };
};

const subject = "Thank you for buying Ryot!";

const PurchaseCompleteEmail = (props: PurchaseCompleteEmailProps) =>
	props.details ? (
		<Layout headingText={subject}>
			<Text>
				You have successfully purchased a {props.planType} plan for Ryot Pro (
				{props.details.__typename}).{" "}
				{props.renewOn
					? `Your subscription will renew on ${props.renewOn}.`
					: null}
			</Text>
			<Text>
				{props.details.__typename === "self_hosted" ? (
					<>
						Your Pro Key is <strong>{props.details.key}</strong>. Please follow{" "}
						<Link href="https://docs.ryot.io#upgrading-to-pro">these</Link>{" "}
						instructions to install/upgrade Ryot with your key.
					</>
				) : (
					<>
						Your account has been created on{" "}
						<Link href={applicationLink}>{applicationLink}</Link> with{" "}
						{isString(props.details.auth) ? (
							`Google using the email ${props.details.auth}. Please login to get started`
						) : (
							<>
								the username <strong>{props.details.auth.username}</strong> and
								password <strong>{props.details.auth.password}</strong>. Please
								login and change your password from the profile settings
							</>
						)}
						.
					</>
				)}
			</Text>
		</Layout>
	) : (
		<></>
	);

PurchaseCompleteEmail.subject = subject;

export default PurchaseCompleteEmail;
