import { REGEXP_ONLY_DIGITS } from "input-otp";
import { PlayIcon } from "lucide-react";
import { Form, Link } from "react-router";
import { $path } from "safe-routes";
import { withQuery } from "ufo";
import { GoogleLogo } from "~/lib/components/icons/GoogleLogo";
import { SectionHeader } from "~/lib/components/SectionHeader";
import { Button } from "~/lib/components/ui/button";
import { Input } from "~/lib/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/lib/components/ui/input-otp";
import { LoadingSpinner } from "~/lib/components/ui/loading-spinner";
import { TurnstileWidget } from "~/lib/components/ui/turnstile";

type RegistrationSectionProps = {
	isLoading: boolean;
	configData?: {
		isLoggedIn: boolean;
		turnstileSiteKey: string;
	};
	query: {
		email?: string;
	};
	loginOtpTurnstileToken: string;
	setLoginOtpTurnstileToken: (token: string) => void;
};

export const RegistrationSection = (props: RegistrationSectionProps) => {
	return (
		<section id="start-here" className="py-20 bg-muted/30">
			<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
				<SectionHeader
					subtitle="Get Started Today"
					title="Upgrade Your Tracking Experience"
					maxWidth="max-w-2xl"
					description={
						<>
							Ready to take control of your personal data and gain meaningful
							insights into your life? Start your free trial today and see the
							difference Ryot can make.
						</>
					}
				/>
				<div className="mt-8" />
				<div className="max-w-sm mx-auto space-y-4">
					{props.isLoading || !props.configData ? (
						<LoadingSpinner message="Loading registration form..." />
					) : props.configData.isLoggedIn ? (
						<Link to={$path("/me")}>
							<Button size="lg" className="text-base px-8">
								<PlayIcon size={16} className="mr-2" />
								Get started
							</Button>
						</Link>
					) : (
						<>
							<Form
								method="POST"
								className="flex flex-col sm:flex-row gap-4 justify-center"
								action={withQuery(".?index", {
									intent: props.query.email
										? "registerWithEmail"
										: "sendLoginCode",
								})}
							>
								{props.query.email ? (
									<>
										<input
											readOnly
											name="email"
											type="hidden"
											value={props.query.email}
										/>
										<InputOTP
											maxLength={6}
											pattern={REGEXP_ONLY_DIGITS}
											name="otpCode"
											className="justify-center"
										>
											<InputOTPGroup>
												<InputOTPSlot index={0} />
												<InputOTPSlot index={1} />
												<InputOTPSlot index={2} />
												<InputOTPSlot index={3} />
												<InputOTPSlot index={4} />
												<InputOTPSlot index={5} />
											</InputOTPGroup>
										</InputOTP>
										<Button type="submit" size="lg" className="text-base px-8">
											Verify login code
										</Button>
									</>
								) : (
									<>
										<input
											type="hidden"
											name="turnstileToken"
											value={props.loginOtpTurnstileToken}
										/>
										<Input
											type="email"
											name="email"
											className="max-w-lg flex-1"
											placeholder="Enter your email"
										/>
										<Button
											size="lg"
											type="submit"
											className="text-base px-8"
											disabled={!props.loginOtpTurnstileToken}
										>
											Start Your Free Trial
										</Button>
										<TurnstileWidget
											onSuccess={props.setLoginOtpTurnstileToken}
											siteKey={props.configData.turnstileSiteKey}
											onError={() => props.setLoginOtpTurnstileToken("")}
											onExpire={() => props.setLoginOtpTurnstileToken("")}
										/>
									</>
								)}
							</Form>
							<p className="text-xs">OR</p>
							<Form
								method="POST"
								action={withQuery(".?index", { intent: "registerWithOidc" })}
							>
								<Button
									variant="outline"
									size="lg"
									className="text-base px-8 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 hover:text-gray-900"
								>
									<GoogleLogo className="w-5 h-5 mr-2" />
									Sign in with Google
								</Button>
							</Form>
							<p className="text-sm text-muted-foreground">
								No credit card required • 14-day free trial • Cancel anytime
							</p>
							<p className="text-xs text-muted-foreground">
								Sign up to get started with Ryot.{" "}
								<Link
									to={$path("/terms")}
									className="underline underline-offset-2"
								>
									Terms &amp; Conditions
								</Link>
							</p>
						</>
					)}
				</div>
			</div>
		</section>
	);
};
