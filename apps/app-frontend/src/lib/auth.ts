import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start/solid";

export const authClient = createAuthClient({
  plugins: [anonymousClient(), tanstackStartCookies()],
});
