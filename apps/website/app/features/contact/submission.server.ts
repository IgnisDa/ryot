import ContactSubmissionEmail from "@ryot-app/email-templates/emails/contact-submission";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { redirect } from "react-router";
import { withFragment, withQuery } from "ufo";
import { z } from "zod";

import { contactSubmission } from "~/drizzle/schema.server";
import { contactEmail } from "~/lib/general";
import { getDb } from "~/server/config.server";
import { fromPromise } from "~/server/effect.server";
import { sendEmail } from "~/server/mail.server";
import { validateTurnstile } from "~/server/turnstile.server";

const submissionSchema = z.object({
	email: z.email(),
	message: z.string(),
	turnstileToken: z.string(),
});

export const submitContact = Effect.fn(function* (request: Request, form: FormData) {
	const submission = submissionSchema.parse(Object.fromEntries(form.entries()));
	yield* validateTurnstile(request, submission.turnstileToken);
	const ticket = (yield* fromPromise(() =>
		getDb()
			.insert(contactSubmission)
			.values({
				isSpam: false,
				email: submission.email,
				message: submission.message,
				ticketNumber: sql`nextval('ticket_number_seq')`,
			})
			.returning(),
	)).at(0);
	if (ticket?.ticketNumber) {
		yield* sendEmail({
			cc: contactEmail,
			recipient: ticket.email,
			subject: ContactSubmissionEmail.subject,
			element: ContactSubmissionEmail({
				message: ticket.message,
				ticketNumber: Number(ticket.ticketNumber),
			}),
		});
	}
	return redirect(withQuery(withFragment(".", "contact"), { contactSubmission: true }));
});
