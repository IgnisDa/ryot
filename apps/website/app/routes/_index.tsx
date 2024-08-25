import TTLCache from "@isaacs/ttlcache";
import {
	redirect,
	unstable_defineAction,
	unstable_defineLoader,
} from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import LoginCodeEmail from "@ryot/transactional/emails/LoginCode";
import { processSubmission, randomString } from "@ryot/ts-utils";
import {
	IconBrandDiscord,
	IconBrandGithub,
	IconBrandGoogleFilled,
	IconPlayerPlay,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import Autoplay from "embla-carousel-autoplay";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { $path } from "remix-routes";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { SpamError } from "remix-utils/honeypot/server";
import { namedAction } from "remix-utils/named-action";
import { withFragment, withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { contactSubmissions, customers } from "~/drizzle/schema.server";
import Pricing from "~/lib/components/Pricing";
import { Button } from "~/lib/components/ui/button";
import {
	Carousel,
	CarouselContent,
	CarouselItem,
	CarouselNext,
	CarouselPrevious,
} from "~/lib/components/ui/carousel";
import { Input } from "~/lib/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/lib/components/ui/input-otp";
import { Textarea } from "~/lib/components/ui/textarea";
import {
	authCookie,
	db,
	getUserIdFromCookie,
	honeypot,
	oauthClient,
	prices,
	sendEmail,
} from "~/lib/config.server";
import { cn } from "~/lib/utils";

dayjs.extend(duration);

const searchParamsSchema = z.object({
	email: z.string().email().optional(),
	contactSubmission: zx.BoolAsString.optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export const loader = unstable_defineLoader(async ({ request }) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	const userId = await getUserIdFromCookie(request);
	return { prices, query, isLoggedIn: !!userId };
});

const otpCodesCache = new TTLCache<string, string>({
	ttl: dayjs.duration(5, "minutes").asMilliseconds(),
	max: 1000,
});

export const action = unstable_defineAction(async ({ request }) => {
	const formData = await request.clone().formData();
	return await namedAction(request, {
		sendLoginCode: async () => {
			const { email } = processSubmission(formData, emailSchema);
			const otpCode = randomString(6);
			otpCodesCache.set(email, otpCode);
			console.log(`OTP code for ${email} is ${otpCode}`);
			await sendEmail(
				email,
				LoginCodeEmail.subject,
				LoginCodeEmail({ code: otpCode }),
			);
			return redirect(withQuery(withFragment(".", "start-here"), { email }));
		},
		registerWithEmail: async () => {
			const submission = processSubmission(formData, registerSchema);
			const otpCode = otpCodesCache.get(submission.email);
			if (otpCode !== submission.otpCode) throw new Error("Invalid OTP code.");
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
			return redirect($path("/me"), {
				headers: { "set-cookie": await authCookie.serialize(customerId) },
			});
		},
		registerWithOidc: async () => {
			const client = await oauthClient();
			const redirectUrl = client.authorizationUrl({ scope: "openid email" });
			return redirect(redirectUrl);
		},
		contactSubmission: async () => {
			let isSpam = false;
			try {
				honeypot.check(formData);
			} catch (e) {
				if (e instanceof SpamError) isSpam = true;
			}
			const submission = await zx.parseForm(request, contactSubmissionSchema);
			await db
				.insert(contactSubmissions)
				.values({
					isSpam: isSpam,
					email: submission.email,
					message: submission.message,
				})
				.execute();
			return redirect(
				withQuery(withFragment(".", "contact"), { contactSubmission: true }),
			);
		},
	});
});

const intentSchema = z.object({ intent: z.string() });

const emailSchema = z.object({ email: z.string().email() }).merge(intentSchema);

const registerSchema = z
	.object({ otpCode: z.string().length(6) })
	.merge(emailSchema);

const contactSubmissionSchema = z.object({
	email: z.string().email(),
	message: z.string(),
});

export default function Page() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<>
			<section id="hero" className="w-full py-12 md:py-24 lg:py-32 border-y">
				<div className="container space-y-10 xl:space-y-16">
					<div className="grid max-w-[1300px] mx-auto gap-4 sm:px-6 md:px-10 md:grid-cols-2 md:gap-16">
						<div className="space-y-8">
							<h1 className="lg:leading-tighter text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl xl:text-[3.4rem] 2xl:text-[3.75rem]">
								Track Your Life, Your Way with Ryot
							</h1>
							<p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl">
								Ryot is a versatile platform that helps you effortlessly track
								and manage your media, fitness, and more. Say goodbye to manual
								tracking methods like Notion, Google Notes, and Excel.
							</p>
							<div className="space-x-4 mt-6">
								<Link
									to="#start-here"
									className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
								>
									Start Your Free Trial
								</Link>
								<a
									href={demoLink}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
								>
									Try a demo
								</a>
							</div>
						</div>
						<Image
							src="/cta-image.png"
							alt="CTA image"
							className="hidden md:block"
						/>
					</div>
				</div>
			</section>
			<section id="advantages" className="w-full py-12 md:py-24 lg:py-32">
				<div className="container space-y-12 px-4 md:px-6">
					<div className="flex flex-col items-center justify-center space-y-4 text-center">
						<div className="space-y-2">
							<div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm">
								Effortless Tracking
							</div>
							<h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">
								Ditch the Spreadsheets, Embrace Ryot
							</h2>
							<p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
								Ryot's intuitive interface and seamless data integration make it
								a breeze to track your media, fitness, and more. No more manual
								data entry or juggling multiple apps.
							</p>
						</div>
					</div>
					<div className="mx-auto grid items-start gap-8 sm:max-w-4xl sm:grid-cols-2 md:gap-12 lg:max-w-5xl lg:grid-cols-3">
						{advantages.map(({ title, description }) => (
							<div className="grid gap-1" key={title}>
								<h3 className="text-lg font-bold">{title}</h3>
								<p className="text-sm text-muted-foreground">{description}</p>
							</div>
						))}
					</div>
					<div className="flex justify-center flex-col sm:flex-row items-start gap-4">
						<Link
							to="#start-here"
							className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
						>
							Start Your Free Trial
						</Link>
					</div>
				</div>
			</section>
			<section
				id="showcase"
				className="w-full py-12 md:py-24 lg:py-32 bg-muted"
			>
				<div className="container space-y-12 px-4 md:px-6">
					<div className="flex flex-col items-center justify-center space-y-4 text-center">
						<div className="space-y-2">
							<div className="inline-block rounded-lg bg-muted px-3 py-1 text-sm bg-white">
								Ease of Use
							</div>
							<h1 className="lg:leading-tighter text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl xl:text-[3.4rem] 2xl:text-[3.75rem]">
								Focus on What Matters
							</h1>
						</div>
					</div>
					<Carousel plugins={[Autoplay({ delay: 5000 })]}>
						<CarouselContent>
							{showCarouselContents.map((carousel) => (
								<CarouselItem key={carousel.text} className="flex flex-col">
									<p className="mx-auto max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
										{carousel.text}
									</p>
									<div className="my-auto">
										<Image
											src={carousel.image}
											alt={carousel.alt}
											className={cn(
												carousel.smallImage && "hidden md:block",
												"max-h-96 md:max-w-3xl lg:max-w-4xl xl:max-w-6xl",
											)}
										/>
										{carousel.smallImage ? (
											<Image
												src={carousel.smallImage}
												alt={carousel.alt}
												className="md:hidden"
											/>
										) : null}
									</div>
								</CarouselItem>
							))}
						</CarouselContent>
						<div className="hidden md:block">
							<CarouselPrevious />
							<CarouselNext />
						</div>
					</Carousel>
				</div>
			</section>
			<section id="start-here" className="w-full py-12 md:py-24 lg:py-32">
				<div className="container grid items-center justify-center gap-4 px-4 text-center md:px-6">
					<div className="space-y-3">
						<h2 className="text-3xl font-bold tracking-tighter md:text-4xl/tight">
							Upgrade Your Tracking Experience
						</h2>
						<p className="mx-auto max-w-[600px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
							Ryot's powerful features make it the ultimate solution for
							effortless tracking and data management.
						</p>
					</div>
					<div className="mx-auto w-full max-w-sm space-y-2">
						{loaderData.isLoggedIn ? (
							<Link to={$path("/me")}>
								<Button>
									<IconPlayerPlay size={16} className="mr-2" />
									<span>Get started</span>
								</Button>
							</Link>
						) : (
							<>
								<Form method="POST" className="flex gap-2 flex-none">
									<input
										readOnly
										type="hidden"
										name="intent"
										value={
											loaderData.query.email
												? "registerWithEmail"
												: "sendLoginCode"
										}
									/>
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
												pattern={REGEXP_ONLY_DIGITS_AND_CHARS}
												name="otpCode"
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
										</>
									) : (
										<Input
											type="email"
											name="email"
											placeholder="Enter your email"
											className="max-w-lg flex-1"
										/>
									)}
									<Button type="submit">
										{loaderData.query.email
											? "Verify login code"
											: "Start Your Free Trial"}
									</Button>
								</Form>
								<p className="text-xs">OR</p>
								<Form method="POST">
									<input
										type="hidden"
										name="intent"
										defaultValue="registerWithOidc"
									/>
									<Button
										variant="outline"
										className="inline-flex h-10 items-center justify-center rounded-md px-8 text-sm font-medium"
									>
										<IconBrandGoogleFilled className="mr-2 h-4 w-4" />
										Sign in with Google
									</Button>
								</Form>
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
			<section
				id="testimonials"
				className="w-full py-12 md:py-24 lg:py-32 bg-muted"
			>
				<div className="container grid items-center justify-center gap-4 px-4 text-center md:px-6 lg:gap-10">
					<div className="space-y-3">
						<h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
							Trusted by Thousands
						</h2>
						<p className="mx-auto max-w-[700px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
							Ryot is trusted by thousands of users worldwide to track their
							media, fitness, and more. Join them and upgrade your tracking
							experience today.
						</p>
					</div>
					<div className="divide-y rounded-lg border">
						<div className="mx-auto md:flex w-full items-center justify-center p-4 sm:p-8 space-y-4 gap-x-4">
							<Image
								src="https://cdn.fosstodon.org/accounts/avatars/110/575/489/884/720/641/original/7312eb6f27068401.jpeg"
								alt="Fosstodon logo"
								className="size-20 rounded-full flex-none"
							/>
							<p>
								I love how easy it is to quickly add a game, book, movie or show
								after I'm finished and write a short review. It's probably the
								most used software on my home server, and has greatly encouraged
								me to watch more movies! IgnisDa has put a great amount of
								attention to detail into this software, and is always available
								for help any step of the way! -{" "}
								<a
									href="https://fosstodon.org/@beppi"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:underline"
								>
									<strong>@beppi</strong>
								</a>
							</p>
						</div>
						<div className="grid w-full grid-cols-3 items-stretch justify-center divide" />
					</div>
				</div>
			</section>
			<Pricing prices={loaderData.prices} isLoggedIn={loaderData.isLoggedIn} />
			<section id="contact" className="w-full py-12 md:py-24 lg:py-32 bg-muted">
				<div className="container px-4 md:px-6">
					<div className="flex flex-col items-center justify-center space-y-4 text-center">
						<div className="space-y-2">
							<div className="inline-block rounded-lg px-3 py-1 text-sm bg-white">
								Contact Us
							</div>
							<h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
								Get in Touch
							</h2>
							<p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
								Have a question or need help with Ryot? Reach out to us and
								we'll get back to you as soon as possible. Alternatively, join
								the Discord community to chat with other users.
							</p>
						</div>
					</div>
					{loaderData.query.contactSubmission ? (
						<p className="text-center text-lg text-primary mt-10">
							Your message has been submitted. We'll get back to you soon!
						</p>
					) : (
						<Form
							method="POST"
							className="flex flex-col items-center justify-center pt-12 gap-y-4 gap-x-4"
						>
							<input
								type="hidden"
								name="intent"
								defaultValue="contactSubmission"
							/>
							<HoneypotInputs />
							<Input
								type="email"
								name="email"
								placeholder="Email"
								className="max-w-lg"
								required
							/>
							<Textarea
								name="message"
								placeholder="Type your message here"
								className="max-w-lg"
								required
							/>
							<Button type="submit">Submit</Button>
						</Form>
					)}
				</div>
			</section>
			<section id="community" className="w-full py-12 md:py-24 lg:py-32">
				<div className="container px-4 md:px-6">
					<div className="flex flex-col items-center justify-center space-y-4 text-center">
						<div className="space-y-2">
							<div className="inline-block rounded-lg px-3 py-1 text-sm bg-muted">
								Open Source
							</div>
							<h2 className="text-3xl font-bold tracking-tighter sm:text-5xl">
								Be Part of the Community
							</h2>
							<p className="max-w-[900px] text-muted-foreground md:text-xl/relaxed lg:text-base/relaxed xl:text-xl/relaxed">
								The community version of Ryot is open source and is available
								for free. Contribute to the project and help shape the future of
								tracking.
							</p>
						</div>
					</div>
					<div className="flex flex-col sm:flex-row items-center justify-center pt-12 gap-y-4 gap-x-4">
						<a
							href="https://discord.gg/D9XTg2a7R8"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Button>
								<IconBrandDiscord className="mr-2" />
								<span>Join the Discord</span>
							</Button>
						</a>
						<a
							href="https://github.com/IgnisDa/ryot"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Button variant="outline">
								<IconBrandGithub className="mr-2" />
								<span>Explore the Code</span>
							</Button>
						</a>
					</div>
				</div>
			</section>
		</>
	);
}

const demoLink = "https://pro.ryot.io/_s/acl_vUMPnPirkHlT";

const advantages = [
	{
		title: "Ditch the Spreadsheets",
		description:
			"Say goodbye to the hassle of manual data entry in Notion, Excel or Google Sheets. Ryot automates the process, giving you more time to focus on what matters.",
	},
	{
		title: "Seamless Data Integration",
		description:
			"Ryot seamlessly integrates with your favorite apps and services, allowing you to centralize all your data in one place.",
	},
	{
		title: "Advanced Analytics",
		description:
			"Gain valuable insights with Ryot's advanced analytics features. Visualize your data, identify trends, and make informed decisions.",
	},
	{
		title: "Stay informed",
		description:
			"Ryot keeps you informed with timely notifications and reminders. Never miss your favorite show's new episode or actor's latest release.",
	},
	{
		title: "Customizable",
		description:
			"Ryot is highly customizable and adapts to your unique tracking needs. Enable or disable facets to tailor the platform to your preferences.",
	},
	{
		title: "Multi Platform",
		description:
			"Ryot is available on all platforms, including web, mobile, and desktop. Access your data anytime, anywhere.",
	},
];

type ImageProps = {
	src: string;
	alt: string;
	className: string;
};

const Image = ({ src, alt, className }: ImageProps) => (
	<img
		src={src}
		alt={alt}
		className={cn(
			className,
			"mx-auto aspect-[16/9] overflow-hidden rounded-xl object-cover",
		)}
	/>
);

const showCarouselContents = [
	{
		text: "You can selectively enable or disable the facets you want to track. Spend less time learning the platform and more time tracking what matters to you. Get started in minutes.",
		image: "/group.png",
		smallImage: "/desktop.png",
		alt: "Grouped images",
	},
	{
		text: "Share your profile data with friends and family without compromising your privacy. Ryot allows you to create access links with limited access so that others can view your favorite movies without logging in.",
		image: "/sharing.png",
		alt: "Sharing images",
	},
	{
		text: "Browse your favorite genres and get recommendations based on your preferences. Ryot uses advanced algorithms to suggest movies, shows, and books you might like.",
		image: "/genres.png",
		alt: "Genres images",
	},
];