import { CheckCircle } from "lucide-react";
import { Form } from "react-router";
import { withQuery } from "ufo";
import { SectionHeader } from "~/lib/components/SectionHeader";
import { Button } from "~/lib/components/ui/button";
import { Card, CardContent } from "~/lib/components/ui/card";
import { Input } from "~/lib/components/ui/input";
import { LoadingSpinner } from "~/lib/components/ui/loading-spinner";
import { Textarea } from "~/lib/components/ui/textarea";
import { TurnstileWidget } from "~/lib/components/ui/turnstile";

type ContactSectionProps = {
	isLoading: boolean;
	configData?: {
		turnstileSiteKey: string;
	};
	query: {
		contactSubmission: boolean;
	};
	contactSubmissionTurnstileToken: string;
	setContactSubmissionTurnstileToken: (token: string) => void;
};

export const ContactSection = (props: ContactSectionProps) => {
	return (
		<section id="contact" className="py-20 bg-muted/30">
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
				<SectionHeader
					subtitle="Get in Touch"
					title="Have Questions? We're Here to Help"
					maxWidth="max-w-2xl"
					description="Whether you need technical support, have feature requests, or want to learn more about Ryot, we'd love to hear from you."
				/>

				{props.query.contactSubmission ? (
					<Card className="max-w-2xl mx-auto border-2 rounded-xl">
						<CardContent className="p-8 text-center">
							<CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
							<h3 className="text-xl font-semibold text-foreground mb-2">
								Message Sent Successfully!
							</h3>
							<p className="text-muted-foreground">
								Your message has been submitted. We'll get back to you soon!
							</p>
						</CardContent>
					</Card>
				) : props.isLoading || !props.configData ? (
					<Card className="max-w-2xl mx-auto border-2 rounded-xl">
						<CardContent className="p-8 text-center">
							<LoadingSpinner message="Loading contact form..." />
						</CardContent>
					</Card>
				) : (
					<Card className="max-w-2xl mx-auto border-2 rounded-xl">
						<CardContent className="p-8">
							<Form
								method="POST"
								action={withQuery(".?index", { intent: "contactSubmission" })}
								className="space-y-6"
							>
								<div>
									<label
										htmlFor="contact-email"
										className="block mb-2 text-sm font-medium text-foreground"
									>
										Email
									</label>
									<Input
										required
										type="email"
										name="email"
										id="contact-email"
										placeholder="your@email.com"
									/>
								</div>
								<div>
									<label
										htmlFor="contact-message"
										className="block mb-2 text-sm font-medium text-foreground"
									>
										Message
									</label>
									<Textarea
										rows={6}
										required
										name="message"
										id="contact-message"
										placeholder="Tell us how we can help you..."
									/>
								</div>
								<TurnstileWidget
									siteKey={props.configData.turnstileSiteKey}
									onSuccess={props.setContactSubmissionTurnstileToken}
									onError={() => props.setContactSubmissionTurnstileToken("")}
									onExpire={() => props.setContactSubmissionTurnstileToken("")}
								/>
								<input
									type="hidden"
									name="turnstileToken"
									value={props.contactSubmissionTurnstileToken}
								/>
								<Button
									type="submit"
									className="w-full"
									disabled={!props.contactSubmissionTurnstileToken}
								>
									Send Message
								</Button>
							</Form>
						</CardContent>
					</Card>
				)}
			</div>
		</section>
	);
};
