import { Effect, Schedule } from "effect";
import { type ParsedMail, simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

import { fromPromise, WebsiteFailure } from "../../../app/server/effect.server";

export const startInbox = Effect.fn(function* () {
	const messages: ParsedMail[] = [];
	const context = yield* Effect.context();
	let rejectNext = false;
	const smtp = yield* Effect.acquireRelease(
		Effect.callback<SMTPServer, WebsiteFailure>((resume) => {
			const server = new SMTPServer({
				authOptional: true,
				disabledCommands: ["STARTTLS"],
				onData(stream, _session, complete) {
					Effect.runCallbackWith(context)(
						fromPromise(() => simpleParser(stream)),
						{
							onExit(exit) {
								if (exit._tag === "Failure" || rejectNext) {
									rejectNext = false;
									complete(new Error("Mailbox temporarily unavailable"));
								} else {
									messages.push(exit.value);
									complete();
								}
							},
						},
					);
				},
			});
			server.once("error", (cause) => resume(Effect.fail(new WebsiteFailure({ cause }))));
			server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)));
		}),
		(server) => Effect.callback<void>((resume) => server.close(() => resume(Effect.void))),
	);
	const address = smtp.server.address();
	if (!address || typeof address === "string") {
		return yield* Effect.die("SMTP did not bind a port");
	}
	return {
		messages,
		port: address.port,
		rejectNextDelivery: () => {
			rejectNext = true;
		},
		findMessage: (email: string, subject?: string) =>
			Effect.sync(() =>
				messages.find(
					(message) =>
						(subject === undefined || message.subject === subject) &&
						[message.to]
							.flat()
							.some((recipient) => recipient?.value.some((mailbox) => mailbox.address === email)),
				),
			).pipe(
				Effect.filterOrFail(
					(message) => message !== undefined,
					() => new WebsiteFailure({ cause: "Email not received" }),
				),
				Effect.retry({ times: 40, schedule: Schedule.spaced("100 millis") }),
			),
	};
});
