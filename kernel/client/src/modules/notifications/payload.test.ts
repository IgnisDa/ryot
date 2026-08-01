import type { SchemaFormValues } from "@ryot-app/client-ui-sdk/schema-form";
import { notificationChannelKinds } from "@ryot-app/contract/modules/notifications/types";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { createNotificationChannelBody, initialNotificationChannelFormValues } from "./payload";

const complete = {
	ntfy: { topic: "ryot" },
	push_over: { userKey: "user-key" },
	push_safer: { key: "private-key" },
	email: { recipient: "someone@example.com" },
	push_bullet: { accessToken: "access-token" },
	discord: { webhookUrl: "https://discord.com/api/webhooks/1/abc" },
	telegram: { chatId: "-1001234567890", botToken: "123:bot-token" },
	gotify: { baseUrl: "https://gotify.example.com", token: "app-token" },
	apprise: { baseUrl: "https://apprise.example.com", key: "config-key" },
} as const;

const succeed = (kind: keyof typeof complete, values: SchemaFormValues) => {
	const body = createNotificationChannelBody({ kind, values });
	if (Result.isFailure(body)) {
		throw new Error(`expected ${kind} to decode`);
	}
	return body.success;
};

describe("createNotificationChannelBody", () => {
	it.each(notificationChannelKinds)("builds a %s channel from its required fields", (kind) => {
		const body = succeed(kind, { ...complete[kind] });

		expect(body.channel).toBe(kind);
		expect(body.channelSpecifics).toEqual({ kind, ...complete[kind] });
	});

	it("omits optional fields the user left blank rather than sending empty strings", () => {
		const body = succeed("ntfy", {
			...initialNotificationChannelFormValues("ntfy"),
			topic: "ryot",
		});

		expect(body.channelSpecifics).toEqual({ kind: "ntfy", topic: "ryot" });
	});

	it("keeps optional fields the user filled in", () => {
		const body = succeed("ntfy", {
			priority: 5,
			topic: "ryot",
			accessToken: "tk_secret",
			baseUrl: "https://ntfy.example.com",
		});

		expect(body.channelSpecifics).toEqual({
			priority: 5,
			kind: "ntfy",
			topic: "ryot",
			accessToken: "tk_secret",
			baseUrl: "https://ntfy.example.com",
		});
	});

	it("fails when a required field is missing", () => {
		expect(Result.isFailure(createNotificationChannelBody({ kind: "ntfy", values: {} }))).toBe(
			true,
		);
	});

	it("fails when a url field is not a url", () => {
		const body = createNotificationChannelBody({
			kind: "discord",
			values: { webhookUrl: "not-a-url" },
		});

		expect(Result.isFailure(body)).toBe(true);
	});

	it("fails when an email field is not an email", () => {
		const body = createNotificationChannelBody({
			kind: "email",
			values: { recipient: "not-an-email" },
		});

		expect(Result.isFailure(body)).toBe(true);
	});
});
