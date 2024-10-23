import TTLCache from "@isaacs/ttlcache";
import {
	type ActionFunctionArgs,
	type LoaderFunctionArgs,
	redirect,
} from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import LoginCodeEmail from "@ryot/transactional/emails/LoginCode";
import { processSubmission, randomString } from "@ryot/ts-utils";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { $path } from "remix-routes";
import { namedAction } from "remix-utils/named-action";
import { withQuery } from "ufo";
import { z } from "zod";
import { zx } from "zodix";
import { customers } from "~/drizzle/schema.server";
import { Button } from "~/lib/components/ui/button";
import { Input } from "~/lib/components/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSlot,
} from "~/lib/components/ui/input-otp";
import { Label } from "~/lib/components/ui/label";
import { authCookie, db, oauthClient, sendEmail } from "~/lib/config.server";

dayjs.extend(duration);

const searchParamsSchema = z.object({
	email: z.string().email().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

const otpCodesCache = new TTLCache<string, string>({
	ttl: dayjs.duration(5, "minutes").asMilliseconds(),
	max: 1000,
});

export const loader = async ({ request }: LoaderFunctionArgs) => {
	const query = zx.parseQuery(request, searchParamsSchema);
	return { query };
};

export const action = async ({ request }: ActionFunctionArgs) => {
	const formData = await request.clone().formData();
	return await namedAction(request, {
		sendLoginCode: async () => {
			const { email } = processSubmission(formData, emailSchema);
			const otpCode = randomString(6);
			otpCodesCache.set(email, otpCode);
			await sendEmail(
				email,
				LoginCodeEmail.subject,
				LoginCodeEmail({ code: otpCode }),
			);
			return redirect(withQuery(".", { email }));
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
			return redirect($path("/"), {
				headers: { "set-cookie": await authCookie.serialize(customerId) },
			});
		},
		registerWithOidc: async () => {
			const client = await oauthClient();
			const redirectUrl = client.authorizationUrl({ scope: "openid email" });
			return redirect(redirectUrl);
		},
	});
};

const emailSchema = z.object({
	email: z.string().email(),
});

const registerSchema = z
	.object({ otpCode: z.string().length(6) })
	.merge(emailSchema);

export default function Index() {
	const loaderData = useLoaderData<typeof loader>();

	return (
		<div>
			<Form
				method="POST"
				action={withQuery(".", {
					intent: loaderData.query.email
						? "registerWithEmail"
						: "sendLoginCode",
				})}
				className="rounded-2xl border space-y-4 m-4 p-4"
			>
				<div>
					<Label htmlFor="email">
						{loaderData.query.email ? "Enter the code" : "Email"}
					</Label>
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
						<Input id="email" name="email" type="email" />
					)}
				</div>
				<Button type="submit">
					{loaderData.query.email ? "Register" : "Send Login Code"}
				</Button>
			</Form>
			<Form
				method="POST"
				action={withQuery("?index", { intent: "registerWithOidc" })}
				className="rounded-2xl border space-y-4 m-4 p-4"
			>
				<Button type="submit">Sign up with Google</Button>
			</Form>
		</div>
	);
}
