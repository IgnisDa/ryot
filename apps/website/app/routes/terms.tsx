const email = "ignisda2001@gmail.com";

export const meta = () => {
	return [{ title: "Terms and conditions | Ryot" }];
};

export default function Index() {
	return (
		<div className="my-48 prose lg:prose-lg container mx-auto">
			<h1>Terms of Service</h1>

			<h2>1. Introduction</h2>
			<p>
				Welcome to Ryot! These Terms of Service ("Terms") govern your use of the
				Ryot software ("Service"). By accessing or using the Service, you agree
				to be bound by these Terms.
			</p>

			<h2>2. Company Information</h2>
			<p>
				<strong>Ryot</strong>, Pocket A-3, Kalkaji Extension, New Delhi 110019,
				Delhi, India
				<br />
				Email: <a href={`mailto:${email}`}>{email}</a>
			</p>

			<h2>3. User Eligibility</h2>
			<p>
				The Service is available to users worldwide with no specific age or
				residency restrictions.
			</p>

			<h2>4. User Accounts and Pro Key</h2>
			<p>
				Users can self-host the software and create accounts on their own
				infrastructure. A "Pro Key" is required to verify the purchase of the
				software. Users are responsible for securing their Pro Keys and ensuring
				their accounts are used in accordance with these Terms.
			</p>

			<h2>5. Subscription and Payments</h2>
			<p>
				The Service offers monthly and yearly subscription plans. Payments must
				be made on time to maintain access to the Pro features. Failure to pay
				on time may result in the revocation of your Pro Key and the
				deactivation of your server.
			</p>

			<h2>6. User Conduct</h2>
			<p>
				Users must use the Service in a lawful and respectful manner. Any misuse
				of the Service, including but not limited to distributing illegal
				content, harassing other users, or attempting to breach the security of
				the Service, is prohibited.
			</p>

			<h2>7. Content Ownership</h2>
			<p>
				All content uploaded by users remains their property. By using the
				Service, users grant Ryot a limited, non-exclusive license to use,
				store, and display this content solely to provide the Service. Users
				must have the necessary rights to any content they upload.
			</p>

			<h2>8. Data Privacy</h2>
			<p>
				Ryot is committed to protecting user data. We collect, store, and use
				personal data in accordance with our Privacy Policy. By using the
				Service, you consent to such collection and use.
			</p>

			<h2>9. Dispute Resolution</h2>
			<p>
				Any disputes arising from or relating to these Terms will be resolved
				through binding arbitration in accordance with the rules of the Indian
				Arbitration and Conciliation Act, 1996.
			</p>

			<h2>10. Changes to Terms</h2>
			<p>
				Ryot reserves the right to update these Terms at any time. Users will be
				notified of any changes via email or through the Service. Continued use
				of the Service after such changes will constitute acceptance of the new
				Terms.
			</p>

			<h2>11. Termination</h2>
			<p>
				Ryot reserves the right to revoke your Pro Key and deactivate your
				server if subscription payments are not made on time. This action will
				prevent your server from starting up and accessing Pro features.
			</p>

			<h2>12. Cancellation and Refund Policies</h2>
			<p>
				Users may cancel their subscription at any time. To cancel, please
				contact us at <a href={`mailto:${email}`}>{email}</a>. Refunds will be
				processed in accordance with Indian laws and regulations.
			</p>
			<p>
				If you cancel within the first 14 days of a monthly subscription, you
				are eligible for a full refund. For yearly subscriptions, cancellations
				within the first 30 days are eligible for a full refund. After these
				periods, refunds will not be provided.
			</p>
			<p>
				Refund requests should be made by contacting our support team. We
				reserve the right to review and approve or deny refund requests based on
				individual circumstances and in compliance with applicable laws.
			</p>

			<p>
				By using Ryot, you acknowledge that you have read, understood, and agree
				to these Terms of Service. If you do not agree to these Terms, please do
				not use the Service.
			</p>
		</div>
	);
}
