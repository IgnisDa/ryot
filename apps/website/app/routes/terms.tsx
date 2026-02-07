import { FileText, Mail, MapPin, Scale } from "lucide-react";
import { SectionHeader } from "~/lib/components/SectionHeader";
import { TermsSection } from "~/lib/components/TermsSection";
import { Card, CardContent } from "~/lib/components/ui/card";
import { contactEmail } from "~/lib/general";

export const meta = () => {
	return [{ title: "Terms and conditions | Ryot" }];
};

export default function Index() {
	return (
		<>
			<section className="py-10 lg:py-20 bg-muted/30">
				<div className="max-w-4xl mx-auto px-4">
					<SectionHeader
						as="h1"
						icon={Scale}
						badgeVariant="secondary"
						subtitle="Legal Information"
						title="Terms of Service"
						maxWidth="max-w-2xl"
						description="Please read these terms carefully before using Ryot. By accessing or using our service, you agree to be bound by these terms and conditions."
					/>
				</div>
			</section>

			<section className="py-10">
				<div className="max-w-4xl mx-auto px-4">
					<Card className="mb-8">
						<CardContent className="p-4 sm:p-8">
							<TermsSection number={1} title="Introduction">
								<p className="text-muted-foreground leading-relaxed">
									Welcome to Ryot! These Terms of Service ("Terms") govern your
									use of the Ryot software ("Service"). By accessing or using
									the Service, you agree to be bound by these Terms.
								</p>
							</TermsSection>

							<TermsSection number={2} title="Company Information">
								<div className="bg-muted/50 p-4 sm:p-6 rounded-lg space-y-3">
									<div className="flex items-center">
										<MapPin className="w-4 h-4 text-muted-foreground mr-3" />
										<span className="text-foreground">
											Ryot, Pocket A-3, Kalkaji Extension, New Delhi 110019,
											Delhi, India
										</span>
									</div>
									<div className="flex items-center">
										<Mail className="w-4 h-4 text-muted-foreground mr-3" />
										<a
											href={`mailto:${contactEmail}`}
											className="text-primary hover:underline"
										>
											{contactEmail}
										</a>
									</div>
								</div>
							</TermsSection>

							<TermsSection number={3} title="User Eligibility">
								<p className="text-muted-foreground leading-relaxed">
									The Service is not directed to children. You may use the
									Service only if you are at least 13 years old (or 16 where
									required by local law). By using the Service, you represent
									that you meet the minimum age requirement and have the
									capacity to enter into these Terms.
								</p>
							</TermsSection>

							<TermsSection number={4} title="User Accounts and Pro Key">
								<p className="text-muted-foreground leading-relaxed">
									Users can self-host the software and create accounts on their
									own infrastructure. A "Pro Key" is required to verify the
									purchase of the software. Users are responsible for securing
									their Pro Keys and ensuring their accounts are used in
									accordance with these Terms.
								</p>
							</TermsSection>

							<TermsSection number={5} title="Subscription and Payments">
								<p className="text-muted-foreground leading-relaxed">
									The Service offers monthly and yearly subscription plans.
									Payments must be made on time to maintain access to the Pro
									features. Failure to pay on time may result in the revocation
									of your Pro Key and the deactivation of your server.
								</p>
							</TermsSection>

							<TermsSection number={6} title="User Conduct">
								<p className="text-muted-foreground leading-relaxed">
									Users must use the Service in a lawful and respectful manner.
									Any misuse of the Service, including but not limited to
									distributing illegal content, harassing other users, or
									attempting to breach the security of the Service, is
									prohibited.
								</p>
							</TermsSection>

							<TermsSection number={7} title="Content Ownership">
								<p className="text-muted-foreground leading-relaxed">
									All content uploaded by users remains their property. By using
									the Service, users grant Ryot a limited, non-exclusive license
									to use, store, and display this content solely to provide the
									Service. Users must have the necessary rights to any content
									they upload.
								</p>
							</TermsSection>

							<TermsSection number={8} title="Data Privacy">
								<div className="space-y-4 text-muted-foreground leading-relaxed">
									<p>
										We care about your privacy and collect the minimum data
										necessary to operate Ryot. We do not sell your data. This
										section explains what we collect and how we use it.
									</p>

									<div className="bg-muted/50 p-4 sm:p-6 rounded-lg">
										<h4 className="font-semibold text-foreground mb-3">
											Self-hosted vs Cloud
										</h4>
										<ul className="space-y-2">
											<li className="flex items-start">
												<span className="w-2 h-2 bg-primary rounded-full mr-3 mt-2 shrink-0" />
												<span>
													<strong className="text-foreground">
														Self-hosted:
													</strong>{" "}
													Your data stays on your own infrastructure. We do not
													receive your tracked content or activity from your
													instance. For self-hosted purchases we store minimal
													licensing and subscription metadata (e.g., email, plan
													type, renewal dates) to issue and manage your Pro Key.
												</span>
											</li>
											<li className="flex items-start">
												<span className="w-2 h-2 bg-primary rounded-full mr-3 mt-2 shrink-0" />
												<span>
													<strong className="text-foreground">
														Ryot Cloud (hosted by us):
													</strong>{" "}
													We store account information (such as your email) and
													the data you add to the service to provide and
													maintain your account. You can request export or
													deletion at any time by contacting
													<a
														href={`mailto:${contactEmail}`}
														className="text-primary hover:underline"
													>
														{" "}
														{contactEmail}
													</a>
													.
												</span>
											</li>
										</ul>
									</div>

									<div className="bg-muted/50 p-4 sm:p-6 rounded-lg">
										<h4 className="font-semibold text-foreground mb-3">
											Website analytics
										</h4>
										<p>
											We use Umami (a privacy-friendly analytics tool) on our
											website to understand aggregate usage and improve the
											site. It does not identify you personally. No behavioral
											profiling or ad targeting is performed.
										</p>
									</div>

									<div className="bg-muted/50 p-4 sm:p-6 rounded-lg">
										<h4 className="font-semibold text-foreground mb-3">
											Payments and processors
										</h4>
										<ul className="space-y-2">
											<li className="flex items-start">
												<span className="w-2 h-2 bg-primary rounded-full mr-3 mt-2 shrink-0" />
												<span>
													Payments are processed by Paddle or Polar.sh
													(depending on your account). We receive transaction
													and subscription metadata from these payment
													processors to provision your purchase and manage
													renewals.
												</span>
											</li>
											<li className="flex items-start">
												<span className="w-2 h-2 bg-primary rounded-full mr-3 mt-2 shrink-0" />
												<span>
													We use an email provider to send receipts and account
													emails, and Unkey to issue and manage self-hosted Pro
													keys. These providers receive only the data needed to
													perform their services.
												</span>
											</li>
										</ul>
									</div>

									<div className="bg-muted/50 p-4 sm:p-6 rounded-lg">
										<h4 className="font-semibold text-foreground mb-3">
											Cookies
										</h4>
										<p>
											We use strictly necessary first-party cookies only where
											required (for example, to authenticate customers in the
											website portal). We do not use cookies for advertising.
											Our analytics is cookie-free.
										</p>
									</div>

									<p>
										<strong className="text-foreground">Your choices:</strong>{" "}
										You may request access, export, correction, or deletion of
										your account data by emailing
										<a
											href={`mailto:${contactEmail}`}
											className="text-primary hover:underline"
										>
											{" "}
											{contactEmail}
										</a>
										.
									</p>

									<p>
										If we make material changes to these privacy practices, we
										will notify you via email or through the Service.
									</p>
								</div>
							</TermsSection>

							<TermsSection number={9} title="Dispute Resolution">
								<p className="text-muted-foreground leading-relaxed">
									Any disputes arising from or relating to these Terms will be
									resolved through binding arbitration in accordance with the
									rules of the Indian Arbitration and Conciliation Act, 1996.
								</p>
							</TermsSection>

							<TermsSection number={10} title="Changes to Terms">
								<p className="text-muted-foreground leading-relaxed">
									Ryot reserves the right to update these Terms at any time.
									Users will be notified of any changes via email or through the
									Service. Continued use of the Service after such changes will
									constitute acceptance of the new Terms.
								</p>
							</TermsSection>

							<TermsSection number={11} title="Termination">
								<p className="text-muted-foreground leading-relaxed">
									Ryot reserves the right to revoke your Pro Key and deactivate
									your server if subscription payments are not made on time.
									This action will prevent your server from starting up and
									accessing Pro features.
								</p>
							</TermsSection>

							<TermsSection
								number={12}
								title="Cancellation and Refund Policies"
							>
								<div className="space-y-4">
									<p className="text-muted-foreground leading-relaxed">
										Users may cancel their subscription at any time. To cancel,
										please contact us at{" "}
										<a
											href={`mailto:${contactEmail}`}
											className="text-primary hover:underline"
										>
											{contactEmail}
										</a>
										. Refunds will be processed in accordance with Indian laws
										and regulations.
									</p>

									<div className="bg-muted/50 p-4 sm:p-6 rounded-lg">
										<h4 className="font-semibold text-foreground mb-3">
											Refund Eligibility:
										</h4>
										<ul className="space-y-2 text-muted-foreground">
											<li className="flex items-start">
												<span className="w-2 h-2 bg-primary rounded-full mr-3 mt-2 shrink-0" />
												<span>
													Monthly subscriptions: Full refund if cancelled within
													the first 14 days
												</span>
											</li>
											<li className="flex items-start">
												<span className="w-2 h-2 bg-primary rounded-full mr-3 mt-2 shrink-0" />
												<span>
													Yearly subscriptions: Full refund if cancelled within
													the first 30 days
												</span>
											</li>
											<li className="flex items-start">
												<span className="w-2 h-2 bg-primary rounded-full mr-3 mt-2 shrink-0" />
												<span>
													After these periods, refunds will not be provided
												</span>
											</li>
										</ul>
									</div>

									<p className="text-muted-foreground leading-relaxed">
										Refund requests should be made by contacting our support
										team. We reserve the right to review and approve or deny
										refund requests based on individual circumstances and in
										compliance with applicable laws.
									</p>
								</div>
							</TermsSection>

							<div className="border-t border-border pt-8">
								<div className="bg-primary/5 p-6 rounded-lg">
									<div className="flex items-start">
										<FileText className="w-5 h-5 text-primary mr-3 mt-1 shrink-0" />
										<p className="text-foreground leading-relaxed">
											<strong>
												By using Ryot, you acknowledge that you have read,
												understood, and agree to these Terms of Service.
											</strong>{" "}
											If you do not agree to these Terms, please do not use the
											Service.
										</p>
									</div>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</section>
		</>
	);
}
