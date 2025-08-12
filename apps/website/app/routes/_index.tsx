import { randomBytes } from "node:crypto";
import TTLCache from "@isaacs/ttlcache";
import ContactSubmissionEmail from "@ryot/transactional/emails/ContactSubmission";
import LoginCodeEmail from "@ryot/transactional/emails/LoginCode";
import {
	cn,
	getActionIntent,
	parseSearchQuery,
	processSubmission,
	zodBoolAsString,
} from "@ryot/ts-utils";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { sql } from "drizzle-orm";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
	CheckCircle,
	Github,
	MessageCircle,
	PlayIcon,
	Shield,
	Star,
	TrendingUp,
	Users,
	Zap,
} from "lucide-react";
import * as openidClient from "openid-client";
import { useState } from "react";
import {
	Form,
	Link,
	data,
	redirect,
	useLoaderData,
	useRouteLoaderData,
} from "react-router";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { SpamError } from "remix-utils/honeypot/server";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withFragment, withQuery } from "ufo";
import { z } from "zod";
import { contactSubmissions, customers } from "~/drizzle/schema.server";
import Pricing from "~/lib/components/Pricing";
import { Badge } from "~/lib/components/ui/badge";
import { Button } from "~/lib/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/lib/components/ui/card";
import { Input } from "~/lib/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/lib/components/ui/input-otp";
import { Textarea } from "~/lib/components/ui/textarea";
import { TurnstileWidget } from "~/lib/components/ui/turnstile";
import {
	OAUTH_CALLBACK_URL,
	db,
	honeypot,
	oauthConfig,
	prices,
	sendEmail,
	serverVariables,
	verifyTurnstileToken,
	websiteAuthCookie,
} from "~/lib/config.server";
import { contactEmail } from "~/lib/utils";
import { startUrl } from "~/lib/utils";
import type { loader as rootLoader } from "../root";
import type { Route } from "./+types/_index";

dayjs.extend(duration);

const searchParamsSchema = z.object({
	email: z.email().optional(),
	contactSubmission: zodBoolAsString.optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = async ({ request }: Route.LoaderArgs) => {
	const query = parseSearchQuery(request, searchParamsSchema);
	return {
		prices,
		query,
		turnstileSiteKey: serverVariables.TURNSTILE_SITE_KEY,
	};
};

const otpCodesCache = new TTLCache<string, string>({
	ttl: dayjs.duration(5, "minutes").asMilliseconds(),
	max: 1000,
});

const generateOtp = (length: number) => {
	const max = 10 ** length;
	const buffer = randomBytes(Math.ceil(length / 2));
	const otp = Number.parseInt(buffer.toString("hex"), 16) % max;
	return otp.toString().padStart(length, "0");
};

export const action = async ({ request }: Route.ActionArgs) => {
	const formData = await request.clone().formData();
	const intent = getActionIntent(request);
	return await match(intent)
		.with("sendLoginCode", async () => {
			const { email } = processSubmission(formData, emailSchema);
			const otpCode = generateOtp(6);
			otpCodesCache.set(email, otpCode);
			console.log("OTP code generated:", { email, otpCode });
			await sendEmail({
				recipient: email,
				subject: LoginCodeEmail.subject,
				element: LoginCodeEmail({ code: otpCode }),
			});
			return redirect(withQuery(startUrl, { email }));
		})
		.with("registerWithEmail", async () => {
			const submission = processSubmission(formData, registerSchema);
			const otpCode = otpCodesCache.get(submission.email);
			if (otpCode !== submission.otpCode)
				throw data({ message: "Invalid OTP code." }, { status: 400 });
			const dbCustomer = await db
				.insert(customers)
				.values({ email: submission.email })
				.returning({ id: customers.id })
				.onConflictDoUpdate({
					target: customers.email,
					set: { email: submission.email },
				});
			const customerId = dbCustomer.at(0)?.id;
			if (!customerId)
				throw new Error("There was an error registering the user.");
			console.log("Customer login successful:", { customerId });
			return redirect($path("/me"), {
				headers: {
					"set-cookie": await websiteAuthCookie.serialize(customerId),
				},
			});
		})
		.with("registerWithOidc", async () => {
			const config = await oauthConfig();
			const redirectUrl = openidClient.buildAuthorizationUrl(config, {
				scope: "openid email",
				redirect_uri: OAUTH_CALLBACK_URL,
			});
			return redirect(redirectUrl.href);
		})
		.with("contactSubmission", async () => {
			// DEV: https://github.com/edmundhung/conform/issues/854
			const submission = contactSubmissionSchema.parse(
				Object.fromEntries(formData.entries()),
			);

			const isTurnstileValid = await verifyTurnstileToken({
				token: submission.turnstileToken,
				remoteIp:
					request.headers.get("cf-connecting-ip") ||
					request.headers.get("x-forwarded-for") ||
					undefined,
			});

			if (!isTurnstileValid) {
				throw data(
					{ message: "CAPTCHA verification failed. Please try again." },
					{ status: 400 },
				);
			}

			let isSpam = false;
			try {
				await honeypot.check(formData);
			} catch (e) {
				if (e instanceof SpamError) isSpam = true;
			}
			const result = await db
				.insert(contactSubmissions)
				.values({
					isSpam: isSpam,
					email: submission.email,
					message: submission.message,
					ticketNumber: isSpam ? null : sql`nextval('ticket_number_seq')`,
				})
				.returning({
					email: contactSubmissions.email,
					message: contactSubmissions.message,
					ticketNumber: contactSubmissions.ticketNumber,
				});

			if (
				!isSpam &&
				result[0]?.ticketNumber &&
				!serverVariables.DISABLE_SENDING_CONTACT_EMAIL
			) {
				const insertedSubmission = result[0];
				await sendEmail({
					cc: contactEmail,
					recipient: insertedSubmission.email,
					subject: ContactSubmissionEmail.subject,
					element: ContactSubmissionEmail({
						message: insertedSubmission.message,
						ticketNumber: Number(insertedSubmission.ticketNumber),
					}),
				});
			}
			return redirect(
				withQuery(withFragment(".", "contact"), { contactSubmission: true }),
			);
		})
		.run();
};

const emailSchema = z.object({ email: z.email() });

const registerSchema = z
	.object({ otpCode: z.string().length(6) })
	.extend(emailSchema.shape);

const contactSubmissionSchema = z
	.object({
		message: z.string(),
		turnstileToken: z.string(),
	})
	.extend(emailSchema.shape);

const FEATURE_CARD_STYLES =
	"border-2 rounded-xl hover:border-primary/20 transition-all duration-300 hover:shadow-lg";

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();
	const rootLoaderData = useRouteLoaderData<typeof rootLoader>("root");

	const [turnstileToken, setTurnstileToken] = useState<string>("");

	return (
		<>
			{/* Hero Section */}
			<section className="relative py-20 lg:py-32 overflow-hidden">
				<div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
					<div className="grid lg:grid-cols-2 gap-12 items-center">
						<div className="max-w-2xl">
							<Badge variant="secondary" className="mb-6">
								<Star className="w-4 h-4 mr-2" />
								Trusted by thousands
							</Badge>
							<h1 className="text-4xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
								Track Your Life, Your Way with{" "}
								<span className="text-primary">Ryot</span>
							</h1>
							<p className="text-lg text-muted-foreground mb-8 leading-relaxed">
								The ultimate personal tracking platform that helps you monitor
								your media consumption, fitness progress, and daily habits all
								in one place. Say goodbye to scattered spreadsheets and hello to
								organized insights.
							</p>
							<div className="flex flex-col sm:flex-row gap-4">
								<Link to="#start-here">
									<Button size="lg" className="text-base px-8">
										Start Free Trial
									</Button>
								</Link>
								<a href={demoLink} target="_blank" rel="noopener noreferrer">
									<Button
										variant="outline"
										size="lg"
										className="text-base px-8"
									>
										Try Live Demo
									</Button>
								</a>
							</div>
						</div>
						<div className="relative">
							<div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 blur-3xl rounded-full" />
							<Image
								src="/cta-image.png"
								alt="Ryot Dashboard Interface showing media tracking capabilities"
								className="relative w-full max-w-2xl mx-auto rounded-2xl"
							/>
						</div>
					</div>
				</div>
			</section>
			{/* Features Section */}
			<section className="py-20 bg-muted/30">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<Badge variant="outline" className="mb-4">
							Why Choose Ryot
						</Badge>
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
							Ditch the Spreadsheets, Embrace Ryot
						</h2>
						<p className="text-lg text-muted-foreground max-w-3xl mx-auto">
							Transform the way you track and analyze your personal data with
							our comprehensive, user-friendly platform designed for modern life
							management.
						</p>
					</div>

					<div className="grid md:grid-cols-3 gap-8">
						<Card className={FEATURE_CARD_STYLES}>
							<CardHeader className="text-center p-8">
								<div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-6">
									<Zap className="w-6 h-6 text-primary" />
								</div>
								<CardTitle className="text-xl mb-4">
									All-in-One Tracking
								</CardTitle>
								<CardDescription className="text-base">
									Monitor your books, movies, TV shows, workouts, and daily
									habits from a single, intuitive dashboard designed for
									comprehensive life tracking.
								</CardDescription>
							</CardHeader>
						</Card>

						<Card className={FEATURE_CARD_STYLES}>
							<CardHeader className="text-center p-8">
								<div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-6">
									<TrendingUp className="w-6 h-6 text-primary" />
								</div>
								<CardTitle className="text-xl mb-4">
									Insightful Analytics
								</CardTitle>
								<CardDescription className="text-base">
									Get detailed insights into your consumption patterns, progress
									trends, and personal growth with beautiful charts and
									meaningful statistics.
								</CardDescription>
							</CardHeader>
						</Card>

						<Card className={FEATURE_CARD_STYLES}>
							<CardHeader className="text-center p-8">
								<div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-6">
									<Shield className="w-6 h-6 text-primary" />
								</div>
								<CardTitle className="text-xl mb-4">Privacy First</CardTitle>
								<CardDescription className="text-base">
									Your personal data stays secure with enterprise-level
									encryption and complete control over your information.
									Self-hosted options available.
								</CardDescription>
							</CardHeader>
						</Card>
					</div>
				</div>
			</section>
			{/* Testimonials Section */}
			<section className="py-20">
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<Badge variant="outline" className="mb-4">
							<Users className="w-4 h-4 mr-2" />
							Social Proof
						</Badge>
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
							Trusted by Thousands
						</h2>
						<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
							Join the growing community of people who have transformed their
							personal tracking experience with Ryot.
						</p>
					</div>

					<div className="grid md:grid-cols-3 gap-8">
						<Card className="bg-card/50 backdrop-blur-sm">
							<CardContent className="pt-6">
								<div className="flex items-center mb-4">
									{[...Array(5)].map((_, i) => (
										<Star
											key={`star-5-${i}`}
											className="w-4 h-4 fill-yellow-400 text-yellow-400"
										/>
									))}
								</div>
								<p className="text-foreground mb-4">
									"I love how easy it is to quickly add a game, book, movie or
									show after I'm finished and write a short review. It's
									probably the most used software on my home server!"
								</p>
								<div className="flex items-center">
									<div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center mr-3">
										<span className="text-primary font-semibold">@B</span>
									</div>
									<div>
										<p className="font-medium">@beppi</p>
										<p className="text-sm text-muted-foreground">
											Fosstodon User
										</p>
									</div>
								</div>
							</CardContent>
						</Card>

						<Card className="bg-card/50 backdrop-blur-sm">
							<CardContent className="pt-6">
								<div className="flex items-center mb-4">
									{[...Array(4)].map((_, i) => (
										<Star
											key={`mike-star-${i}`}
											className="w-4 h-4 fill-yellow-400 text-yellow-400"
										/>
									))}
									<Star
										key="mike-star-empty"
										className="w-4 h-4 text-gray-300"
									/>
								</div>
								<p className="text-foreground mb-4">
									"Finally, a platform that understands what I need for personal
									tracking. The analytics features are exactly what I was
									looking for."
								</p>
								<div className="flex items-center">
									<div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center mr-3">
										<span className="text-primary font-semibold">MC</span>
									</div>
									<div>
										<p className="font-medium">Mike Chen</p>
										<p className="text-sm text-muted-foreground">
											Fitness Enthusiast
										</p>
									</div>
								</div>
							</CardContent>
						</Card>

						<Card className="bg-card/50 backdrop-blur-sm">
							<CardContent className="pt-6">
								<div className="flex items-center mb-4">
									{[...Array(4)].map((_, i) => (
										<Star
											key={`alex-star-${i}`}
											className="w-4 h-4 fill-yellow-400 text-yellow-400"
										/>
									))}
									<Star
										key="alex-star-empty"
										className="w-4 h-4 text-gray-300"
									/>
								</div>
								<p className="text-foreground mb-4">
									"The privacy features and self-hosting option sold me. Great
									for anyone who wants control over their personal data."
								</p>
								<div className="flex items-center">
									<div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center mr-3">
										<span className="text-primary font-semibold">AL</span>
									</div>
									<div>
										<p className="font-medium">Alex Liu</p>
										<p className="text-sm text-muted-foreground">Developer</p>
									</div>
								</div>
							</CardContent>
						</Card>
					</div>
				</div>
			</section>
			{/* Upgrade Section */}
			<section id="start-here" className="py-20 bg-muted/30">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
					<Badge variant="outline" className="mb-4">
						Get Started Today
					</Badge>
					<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
						Upgrade Your Tracking Experience
					</h2>
					<p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
						Ready to take control of your personal data and gain meaningful
						insights into your life? Start your free trial today and see the
						difference Ryot can make.
					</p>
					<div className="max-w-sm mx-auto space-y-4">
						{rootLoaderData?.isLoggedIn ? (
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
										intent: loaderData.query.email
											? "registerWithEmail"
											: "sendLoginCode",
									})}
								>
									{loaderData.query.email ? (
										<>
											<input
												readOnly
												name="email"
												type="hidden"
												value={loaderData.query.email}
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
											<Button
												type="submit"
												size="lg"
												className="text-base px-8"
											>
												Verify login code
											</Button>
										</>
									) : (
										<>
											<Input
												type="email"
												name="email"
												placeholder="Enter your email"
												className="max-w-lg flex-1"
											/>
											<Button
												type="submit"
												size="lg"
												className="text-base px-8"
											>
												Start Your Free Trial
											</Button>
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
										<svg
											className="w-5 h-5 mr-2"
											viewBox="0 0 24 24"
											aria-label="Google logo"
										>
											<title>Google</title>
											<path
												fill="#4285F4"
												d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
											/>
											<path
												fill="#34A853"
												d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
											/>
											<path
												fill="#FBBC05"
												d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
											/>
											<path
												fill="#EA4335"
												d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
											/>
										</svg>
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
			<Pricing
				prices={loaderData.prices}
				isLoggedIn={rootLoaderData?.isLoggedIn}
			/>
			{/* Contact Section */}
			<section id="contact" className="py-20 bg-muted/30">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
					<div className="text-center mb-16">
						<Badge variant="outline" className="mb-4">
							Get in Touch
						</Badge>
						<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
							Have Questions? We're Here to Help
						</h2>
						<p className="text-lg text-muted-foreground max-w-2xl mx-auto">
							Whether you need technical support, have feature requests, or want
							to learn more about Ryot, we'd love to hear from you.
						</p>
					</div>

					{loaderData.query.contactSubmission ? (
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
					) : (
						<Card className="max-w-2xl mx-auto border-2 rounded-xl">
							<CardContent className="p-8">
								<Form
									method="POST"
									action={withQuery(".?index", { intent: "contactSubmission" })}
									className="space-y-6"
								>
									<HoneypotInputs />
									<div>
										<label
											htmlFor="contact-email"
											className="block mb-2 text-sm font-medium text-foreground"
										>
											Email
										</label>
										<Input
											id="contact-email"
											type="email"
											name="email"
											placeholder="your@email.com"
											required
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
											id="contact-message"
											name="message"
											placeholder="Tell us how we can help you..."
											rows={6}
											required
										/>
									</div>
									<div>
										<TurnstileWidget
											onSuccess={setTurnstileToken}
											siteKey={loaderData.turnstileSiteKey}
											onError={() => setTurnstileToken("")}
											onExpire={() => setTurnstileToken("")}
										/>
									</div>
									<input
										type="hidden"
										name="turnstileToken"
										value={turnstileToken}
									/>
									<Button
										type="submit"
										className="w-full"
										disabled={!turnstileToken}
									>
										Send Message
									</Button>
								</Form>
							</CardContent>
						</Card>
					)}
				</div>
			</section>
			{/* Community Section */}
			<section className="py-20">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
					<Badge variant="outline" className="mb-4">
						Join the Community
					</Badge>
					<h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-6">
						Be Part of the Community
					</h2>
					<p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
						Connect with other Ryot users, share tips and tricks, get support,
						and stay updated with the latest features and improvements.
					</p>
					<div className="flex flex-col sm:flex-row gap-4 justify-center">
						<a
							href="https://discord.gg/D9XTg2a7R8"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Button size="lg" className="min-w-[180px]">
								<MessageCircle className="w-5 h-5 mr-2" />
								Join Discord
							</Button>
						</a>
						<a
							href="https://github.com/IgnisDa/ryot"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Button variant="outline" size="lg" className="min-w-[180px]">
								<Github className="w-5 h-5 mr-2" />
								Follow on GitHub
							</Button>
						</a>
					</div>
				</div>
			</section>
		</>
	);
}

const demoLink = "https://demo.ryot.io/_s/acl_QQ7Bb9JvtOrj";

type ImageProps = {
	src: string;
	alt: string;
	className: string;
};

const Image = (props: ImageProps) => (
	<img
		src={props.src}
		alt={props.alt}
		className={cn(
			props.className,
			"mx-auto aspect-16/9 overflow-hidden rounded-xl object-cover",
		)}
	/>
);
