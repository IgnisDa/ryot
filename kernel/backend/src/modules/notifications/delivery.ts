import type { NotificationChannelSpecifics } from "@ryot-app/contract/modules/notifications/schemas";
import { Context, Data, Duration, Effect, Layer, Match, Option, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { AppConfig, getSmtpCredentials } from "#lib/infrastructure/config/service";

const PROJECT_NAME = "Ryot";
const HTTP_TIMEOUT_MS = 10_000;
const PUSHOVER_DEFAULT_APP_TOKEN = "abd1semr21hv1i5j5kfkm23wf1kd4u";
const AVATAR_URL =
	"https://raw.githubusercontent.com/IgnisDa/ryot/main/packages/assets/icon-512x512.png";

export class NotificationDeliveryError extends Data.TaggedError("NotificationDeliveryError")<{
	message: string;
}> {}

type NotificationMailerInput = {
	credentials: { user: string; server: string; password: string };
	mail: { to: string; from: string; html: string; text: string; subject: string };
};

const encodePathSegment = (value: string) => encodeURIComponent(value);

const jsonRequest = (input: {
	url: string;
	body: Record<string, unknown>;
	headers?: Record<string, string>;
}) =>
	HttpClientRequest.make("POST")(input.url).pipe(
		HttpClientRequest.bodyJsonUnsafe(input.body),
		HttpClientRequest.setHeaders(input.headers ?? {}),
	);

const textRequest = (input: { url: string; body: string; headers?: Record<string, string> }) => {
	let request = HttpClientRequest.make("POST")(input.url);
	request = HttpClientRequest.bodyText(input.body)(request);
	return HttpClientRequest.setHeaders(input.headers ?? {})(request);
};

const originLessBaseUrl = (value: string) => value.replace(/\/+$/, "");

export class NotificationMailer extends Context.Service<NotificationMailer>()(
	"NotificationMailer",
	{
		make: Effect.succeed({
			send: Effect.fn("NotificationMailer.send")(function* (input: NotificationMailerInput) {
				const { createTransport } = yield* Effect.promise(() => import("nodemailer"));
				const transport = createTransport({
					port: 465,
					secure: true,
					host: input.credentials.server,
					socketTimeout: HTTP_TIMEOUT_MS,
					greetingTimeout: HTTP_TIMEOUT_MS,
					connectionTimeout: HTTP_TIMEOUT_MS,
					auth: { user: input.credentials.user, pass: input.credentials.password },
				});
				yield* Effect.tryPromise({
					try: () => transport.sendMail(input.mail),
					catch: () => new NotificationDeliveryError({ message: "SMTP request failed" }),
				});
			}),
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export class NotificationDeliveryService extends Context.Service<NotificationDeliveryService>()(
	"NotificationDeliveryService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const mailer = yield* NotificationMailer;
			const httpClient = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

			const sendHttp = Effect.fn("NotificationDeliveryService.sendHttp")(function* (input: {
				provider: string;
				request: HttpClientRequest.HttpClientRequest;
			}) {
				yield* httpClient.execute(input.request).pipe(
					Effect.flatMap((response) => response.text),
					Effect.timeout(Duration.millis(HTTP_TIMEOUT_MS)),
					Effect.mapError(
						() => new NotificationDeliveryError({ message: `${input.provider} request failed` }),
					),
				);
			});

			const sendEmail = Effect.fn("NotificationDeliveryService.sendEmail")(function* (input: {
				message: string;
				recipient: string;
			}) {
				const credentials = getSmtpCredentials(config);
				if (Option.isNone(credentials)) {
					return yield* new NotificationDeliveryError({ message: "SMTP is not configured" });
				}

				const { mailbox } = config.server.smtp;
				const { user, server, password } = credentials.value;
				const [{ render }, { default: GenericEmail }] = yield* Effect.promise(() =>
					Promise.all([
						import("@react-email/components"),
						import("@ryot-app/transactional/emails/generic"),
					]),
				);
				const email = GenericEmail({ message: input.message });
				const [html, text] = yield* Effect.tryPromise({
					try: () => Promise.all([render(email), render(email, { plainText: true })]),
					catch: () => new NotificationDeliveryError({ message: "SMTP request failed" }),
				});

				yield* mailer.send({
					credentials: { server, user: Redacted.value(user), password: Redacted.value(password) },
					mail: {
						text,
						html,
						from: mailbox,
						to: input.recipient,
						subject: `${PROJECT_NAME} notification`,
					},
				});
				return yield* Effect.void;
			});

			const send = Effect.fn("NotificationDeliveryService.send")(function* (input: {
				message: string;
				channelSpecifics: NotificationChannelSpecifics;
			}) {
				const { message, channelSpecifics } = input;
				if (config.server.disableNotifications) {
					return yield* Effect.logWarning("notification delivery disabled").pipe(
						Effect.annotateLogs({ channel: channelSpecifics.kind }),
					);
				}
				return yield* Match.value(channelSpecifics).pipe(
					Match.when({ kind: "apprise" }, (specifics) =>
						sendHttp({
							provider: "Apprise",
							request: jsonRequest({
								body: { body: message, title: PROJECT_NAME },
								url: `${originLessBaseUrl(specifics.baseUrl)}/notify/${encodePathSegment(specifics.key)}`,
							}),
						}),
					),
					Match.when({ kind: "discord" }, (specifics) =>
						sendHttp({
							provider: "Discord",
							request: jsonRequest({
								url: specifics.webhookUrl,
								body: { content: message, avatar_url: AVATAR_URL, username: PROJECT_NAME },
							}),
						}),
					),
					Match.when({ kind: "email" }, (specifics) =>
						sendEmail({ message, recipient: specifics.recipient }),
					),
					Match.when({ kind: "gotify" }, (specifics) =>
						sendHttp({
							provider: "Gotify",
							request: jsonRequest({
								headers: { "X-Gotify-Key": specifics.token },
								url: `${originLessBaseUrl(specifics.baseUrl)}/message`,
								body: {
									message,
									title: PROJECT_NAME,
									priority: specifics.priority ?? 5,
									extras: { "client::notification": { bigImageUrl: AVATAR_URL } },
								},
							}),
						}),
					),
					Match.when({ kind: "ntfy" }, (specifics) => {
						const headers: Record<string, string> = {
							Attach: AVATAR_URL,
							Title: PROJECT_NAME,
							Priority: String(specifics.priority ?? 3),
						};
						if (specifics.accessToken) {
							headers["Authorization"] = `Bearer ${specifics.accessToken}`;
						}
						return sendHttp({
							provider: "ntfy",
							request: textRequest({
								headers,
								body: message,
								url: `${originLessBaseUrl(specifics.baseUrl ?? "https://ntfy.sh")}/${encodePathSegment(specifics.topic)}`,
							}),
						});
					}),
					Match.when({ kind: "push_bullet" }, (specifics) =>
						sendHttp({
							provider: "PushBullet",
							request: jsonRequest({
								url: "https://api.pushbullet.com/v2/pushes",
								headers: { "Access-Token": specifics.accessToken },
								body: { type: "note", body: message, title: PROJECT_NAME },
							}),
						}),
					),
					Match.when({ kind: "push_over" }, (specifics) => {
						const url = new URL("https://api.pushover.net/1/messages.json");
						url.searchParams.set("user", specifics.userKey);
						url.searchParams.set("title", PROJECT_NAME);
						url.searchParams.set("message", message);
						url.searchParams.set("token", specifics.appToken ?? PUSHOVER_DEFAULT_APP_TOKEN);
						if (specifics.device) {
							url.searchParams.set("device", specifics.device);
						}
						return sendHttp({
							provider: "PushOver",
							request: textRequest({ body: "", url: url.toString() }),
						});
					}),
					Match.when({ kind: "push_safer" }, (specifics) => {
						const url = new URL("https://www.pushsafer.com/api");
						url.searchParams.set("k", specifics.key);
						url.searchParams.set("m", message);
						url.searchParams.set("t", PROJECT_NAME);
						return sendHttp({
							provider: "PushSafer",
							request: textRequest({ body: "", url: url.toString() }),
						});
					}),
					Match.when({ kind: "telegram" }, (specifics) =>
						sendHttp({
							provider: "Telegram",
							request: jsonRequest({
								body: { text: message, parse_mode: "Markdown", chat_id: specifics.chatId },
								url: `https://api.telegram.org/bot${encodePathSegment(specifics.botToken)}/sendMessage`,
							}),
						}),
					),
					Match.exhaustive,
				);
			});

			return { send };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
