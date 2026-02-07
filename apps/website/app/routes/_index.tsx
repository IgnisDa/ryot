import { randomBytes } from "node:crypto";
import { TTLCache } from "@isaacs/ttlcache";
import ContactSubmissionEmail from "@ryot/transactional/emails/contact-submission";
import LoginCodeEmail from "@ryot/transactional/emails/login-code";
import { getActionIntent, processSubmission } from "@ryot/ts-utils";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { sql } from "drizzle-orm";
import * as openidClient from "openid-client";
import { useState } from "react";
import { data, redirect, useSearchParams } from "react-router";
import { $path } from "safe-routes";
import { match } from "ts-pattern";
import { withFragment, withQuery } from "ufo";
import { z } from "zod";
import { contactSubmissions, customers } from "~/drizzle/schema.server";
import { CommunitySection } from "~/lib/components/CommunitySection";
import { ContactSection } from "~/lib/components/ContactSection";
import { FeaturesSection } from "~/lib/components/FeaturesSection";
import { HeroSection } from "~/lib/components/HeroSection";
import Pricing from "~/lib/components/Pricing";
import { RegistrationSection } from "~/lib/components/RegistrationSection";
import { TestimonialsSection } from "~/lib/components/TestimonialsSection";
import { LoadingSpinner } from "~/lib/components/ui/loading-spinner";
import {
	assignPaymentProvider,
	getDb,
	getOauthCallbackUrl,
	websiteAuthCookie,
} from "~/lib/config.server";
import { contactEmail, startUrl } from "~/lib/general";
import { usePaddleInitialization } from "~/lib/hooks/usePaddleInitialization";
import {
	oauthConfig,
	sendEmail,
	validateTurnstile,
} from "~/lib/utilities.server";
import type { Route } from "./+types/_index";

dayjs.extend(duration);

const otpCodesCache = new TTLCache<string, string>({
	max: 1000,
	ttl: dayjs.duration(5, "minutes").asMilliseconds(),
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
			const submission = processSubmission(formData, sendLoginCodeSchema);
			await validateTurnstile(request, submission.turnstileToken);

			const otpCode = generateOtp(6);
			otpCodesCache.set(submission.email, otpCode);
			console.log("OTP code generated:", { email: submission.email, otpCode });
			await sendEmail({
				recipient: submission.email,
				subject: LoginCodeEmail.subject,
				element: LoginCodeEmail({ code: otpCode }),
			});
			return redirect(withQuery(startUrl, { email: submission.email }));
		})
		.with("registerWithEmail", async () => {
			const submission = processSubmission(formData, registerSchema);
			const otpCode = otpCodesCache.get(submission.email);
			if (otpCode !== submission.otpCode)
				throw data({ message: "Invalid OTP code." }, { status: 400 });
			const paymentProvider = assignPaymentProvider(submission.email);
			const dbCustomer = await getDb()
				.insert(customers)
				.values({ paymentProvider, email: submission.email })
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
				redirect_uri: getOauthCallbackUrl(),
			});
			return redirect(redirectUrl.href);
		})
		.with("contactSubmission", async () => {
			// DEV: https://github.com/edmundhung/conform/issues/854
			const submission = contactSubmissionSchema.parse(
				Object.fromEntries(formData.entries()),
			);

			await validateTurnstile(request, submission.turnstileToken);

			const result = await getDb()
				.insert(contactSubmissions)
				.values({
					isSpam: false,
					email: submission.email,
					message: submission.message,
					ticketNumber: sql`nextval('ticket_number_seq')`,
				})
				.returning({
					email: contactSubmissions.email,
					message: contactSubmissions.message,
					ticketNumber: contactSubmissions.ticketNumber,
				});

			if (result[0]?.ticketNumber) {
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

const turnstileTokenSchema = z.object({
	turnstileToken: z.string(),
});

const emailSchema = z.object({ email: z.email() });

const sendLoginCodeSchema = emailSchema.extend(turnstileTokenSchema.shape);

const registerSchema = z
	.object({ otpCode: z.string().length(6) })
	.extend(emailSchema.shape);

const contactSubmissionSchema = z
	.object({ message: z.string() })
	.extend(emailSchema.shape)
	.extend(turnstileTokenSchema.shape);

export default function Page() {
	const [searchParams] = useSearchParams();
	const { configData, isLoading } = usePaddleInitialization();

	const query = {
		email: searchParams.get("email") ?? undefined,
		contactSubmission: searchParams.get("contactSubmission") === "true",
	};

	const [contactSubmissionTurnstileToken, setContactSubmissionTurnstileToken] =
		useState<string>("");
	const [loginOtpTurnstileToken, setLoginOtpTurnstileToken] =
		useState<string>("");

	return (
		<>
			<HeroSection />
			<FeaturesSection />
			<TestimonialsSection />
			<RegistrationSection
				query={query}
				isLoading={isLoading}
				configData={configData}
				loginOtpTurnstileToken={loginOtpTurnstileToken}
				setLoginOtpTurnstileToken={setLoginOtpTurnstileToken}
			/>
			{isLoading || !configData ? (
				<section className="py-20">
					<div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
						<LoadingSpinner size="lg" message="Loading pricing..." />
					</div>
				</section>
			) : (
				<Pricing
					prices={configData.prices}
					isLoggedIn={configData.isLoggedIn}
				/>
			)}
			<ContactSection
				query={query}
				isLoading={isLoading}
				configData={configData}
				contactSubmissionTurnstileToken={contactSubmissionTurnstileToken}
				setContactSubmissionTurnstileToken={setContactSubmissionTurnstileToken}
			/>
			<CommunitySection />
		</>
	);
}
