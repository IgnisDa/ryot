import { Effect } from "effect";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { match } from "ts-pattern";

import { LoadingSpinner } from "~/components/ui/loading-spinner";
import { RegistrationSection } from "~/features/account/RegistrationSection";
import { beginOidcSignIn, sendLoginCode, verifyLoginCode } from "~/features/account/sign-in.server";
import Pricing from "~/features/billing/Pricing";
import { ContactSection } from "~/features/contact/ContactSection";
import { submitContact } from "~/features/contact/submission.server";
import { CommunitySection } from "~/features/marketing/CommunitySection";
import { FeaturesSection } from "~/features/marketing/FeaturesSection";
import { HeroSection } from "~/features/marketing/HeroSection";
import { TestimonialsSection } from "~/features/marketing/TestimonialsSection";
import { useConfigData } from "~/lib/general";
import { fromPromise } from "~/server/effect.server";
import { getActionIntent } from "~/server/forms.server";
import { runPromise } from "~/server/runtime.server";

import type { Route } from "./+types/_index";

export const action = ({ request }: Route.ActionArgs) =>
	runPromise(
		Effect.gen(function* () {
			const form = yield* fromPromise(() => request.formData());
			return yield* match(getActionIntent(request))
				.with("sendLoginCode", () => sendLoginCode(request, form))
				.with("registerWithEmail", () => verifyLoginCode(form))
				.with("registerWithOidc", beginOidcSignIn)
				.with("contactSubmission", () => submitContact(request, form))
				.otherwise(() => Effect.succeed(new Response(null, { status: 400 })));
		}).pipe(
			Effect.catchIf((error): error is Response => error instanceof Response, Effect.succeed),
		),
	);

export default function Page() {
	const [searchParams] = useSearchParams();
	const { isLoading, data: configData } = useConfigData();

	const query = {
		email: searchParams.get("email") ?? undefined,
		contactSubmission: searchParams.get("contactSubmission") === "true",
	};

	const [loginOtpTurnstileToken, setLoginOtpTurnstileToken] = useState<string>("");
	const [contactSubmissionTurnstileToken, setContactSubmissionTurnstileToken] =
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
				<Pricing prices={configData.prices} isLoggedIn={configData.isLoggedIn} />
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
