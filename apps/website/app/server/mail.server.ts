import { render } from "@react-email/render";
import { Effect } from "effect";
import { createTransport } from "nodemailer";
import type { ReactElement } from "react";

import { getServerVariables, IS_DEVELOPMENT_ENV } from "./config.server";
import { fromPromise } from "./effect.server";

export const sendEmail = (input: {
	cc?: string;
	subject: string;
	recipient: string;
	element: ReactElement;
}) =>
	Effect.gen(function* () {
		if (IS_DEVELOPMENT_ENV) {
			yield* Effect.logWarning("Email sending is disabled in development mode.");
			return "dev-mode-email";
		}
		const serverVariables = getServerVariables();
		const client = createTransport({
			host: serverVariables.SERVER_SMTP_SERVER,
			secure: serverVariables.SERVER_SMTP_SECURE,
			port: serverVariables.SERVER_SMTP_PORT ? Number(serverVariables.SERVER_SMTP_PORT) : undefined,
			auth: serverVariables.SERVER_SMTP_USER
				? { user: serverVariables.SERVER_SMTP_USER, pass: serverVariables.SERVER_SMTP_PASSWORD }
				: undefined,
		});
		const html = yield* fromPromise(() => render(input.element, { pretty: true }));
		const text = yield* fromPromise(() => render(input.element, { plainText: true }));
		const log = { cc: input.cc, subject: input.subject, recipient: input.recipient };
		yield* Effect.log("Sending email:", log);
		const resp = yield* fromPromise(() =>
			client.sendMail({
				text,
				html,
				cc: input.cc,
				to: input.recipient,
				subject: input.subject,
				from: serverVariables.SERVER_SMTP_MAILBOX,
			}),
		);
		yield* Effect.log("Sent email:", log);
		return resp.messageId;
	});
