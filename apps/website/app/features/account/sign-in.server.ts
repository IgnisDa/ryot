import { TTLCache } from "@isaacs/ttlcache";
import LoginCodeEmail from "@ryot-app/email-templates/emails/login-code";
import { Effect } from "effect";
import * as openidClient from "openid-client";
import { redirect } from "react-router";
import { withQuery } from "ufo";
import { z } from "zod";

import { startUrl } from "~/lib/general";
import { getServerVariables, IS_DEVELOPMENT_ENV } from "~/server/config.server";
import { fromPromise } from "~/server/effect.server";
import { processSubmission } from "~/server/forms.server";
import { sendEmail } from "~/server/mail.server";
import { validateTurnstile } from "~/server/turnstile.server";

import { signInCustomer } from "./session.server";

const otpCodesCache = new TTLCache<string, string>({ max: 1000, ttl: 5 * 60_000 });

const generateOtp = (length: number) => {
	const max = 10 ** length;
	const buffer = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
	const otp =
		Number.parseInt(Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(""), 16) %
		max;
	return otp.toString().padStart(length, "0");
};

const setOtpCode = (email: string) => {
	const otpCode = generateOtp(6);
	otpCodesCache.set(email, otpCode);
	return otpCode;
};

const getOtpCode = (email: string) => otpCodesCache.get(email);

const revokeOtpCode = (email: string) => otpCodesCache.delete(email);

const emailSchema = z.object({ email: z.email() });
const requestCodeSchema = emailSchema.extend({ turnstileToken: z.string() });
const verifyCodeSchema = emailSchema.extend({ otpCode: z.string().length(6) });

const oauthConfig = fromPromise(() => {
	const config = getServerVariables();
	return openidClient.discovery(
		new URL(config.SERVER_OIDC_ISSUER_URL),
		config.SERVER_OIDC_CLIENT_ID,
		config.SERVER_OIDC_CLIENT_SECRET,
	);
});

const callbackUrl = () => new URL("/callback", getServerVariables().FRONTEND_URL);

export const sendLoginCode = Effect.fn(function* (request: Request, form: FormData) {
	const { email, turnstileToken } = yield* processSubmission(form, requestCodeSchema);
	yield* validateTurnstile(request, turnstileToken);
	const otpCode = setOtpCode(email);
	if (IS_DEVELOPMENT_ENV) {
		yield* Effect.log("Generated OTP code for login:", { email, otpCode });
	}
	yield* sendEmail({
		recipient: email,
		subject: LoginCodeEmail.subject,
		element: LoginCodeEmail({ code: otpCode }),
	});
	return redirect(withQuery(startUrl, { email }));
});

export const verifyLoginCode = Effect.fn(function* (form: FormData) {
	const { email, otpCode } = yield* processSubmission(form, verifyCodeSchema);
	if (getOtpCode(email) !== otpCode) {
		return new Response(null, { status: 422 });
	}
	revokeOtpCode(email);
	return yield* signInCustomer(email);
});

export const beginOidcSignIn = Effect.fn(function* () {
	const config = yield* oauthConfig;
	return redirect(
		openidClient.buildAuthorizationUrl(config, {
			scope: "openid email",
			redirect_uri: callbackUrl().href,
		}).href,
	);
});

export const finishOidcSignIn = Effect.fn(function* (request: Request) {
	const config = yield* oauthConfig;
	const callback = callbackUrl();
	callback.search = new URL(request.url).search;
	const tokenSet = yield* fromPromise(() => openidClient.authorizationCodeGrant(config, callback));
	const claims = tokenSet.claims();
	if (typeof claims?.email !== "string" || !claims.sub) {
		return new Response(null, { status: 400 });
	}
	return yield* signInCustomer(claims.email, claims.sub);
});
