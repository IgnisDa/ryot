# Connect an AI app with MCP

Ryot exposes a remote MCP server at:

```text
<FRONTEND_URL>/api/mcp
```

Choose **Streamable HTTP** in an AI app that supports remote MCP servers. For example, if your Ryot
address is `https://ryot.example`, enter `https://ryot.example/api/mcp`.

The connection acts as your Ryot account. It can read your data and use the operations exposed by
your installed plugins. What it may change depends on the access level you give it.

## Access levels

Every connection has one of three access levels:

| Level                         | What the app can do                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Read only**                 | Read your data. It cannot change anything.                                                                   |
| **Ask before each change**    | Read your data. Each change is shown to you in your AI app, and happens only after you approve it.           |
| **Allow changes without asking** | Read and change your data, including through your plugins, without asking you first.                      |

**Ask before each change** needs an AI app that supports MCP elicitation, which lets Ryot ask you
to confirm a change. If your app does not support it, Ryot refuses the change and says so; connect
again with **Allow changes without asking** only if you trust the app. Check your app's
documentation for elicitation support.

Choose the lowest level that does the job. A level can only be raised by connecting again.

## Connect with OAuth

Enter the MCP endpoint URL in an app that supports OAuth discovery and public-client dynamic
registration. The app discovers Ryot's authorization server and registers itself without a client
secret. Ryot supports the authorization code flow with S256 PKCE for these public clients.

When the app opens your browser:

1. Sign in to your Ryot server with your usual password or identity provider. Complete two-factor
   authentication if prompted.
2. Check the registered app name and the redirect origin shown on the consent page. App names are
   supplied during registration; Ryot does not verify the publisher.
3. Choose the access level. It starts at **Ask before each change** and never goes above what the app
   asked for.
4. Choose **Approve** to connect or **Deny** to return without granting access.

For clients that ask for the OAuth resource explicitly, use the same complete MCP endpoint URL:
`<FRONTEND_URL>/api/mcp`. Public clients use `token_endpoint_auth_method: none`; confidential-client
registration is not supported. Ryot's own web and mobile apps keep their existing sign-in flow.

## Connect with an API key

Use a key for an app that cannot sign in through your browser. Open **Settings → Access**, choose
**Create key**, name it, pick an access level and an expiry, and copy the key. It is shown only
once. Configure the MCP connection to send it on every request:

```text
X-Api-Key: <your-api-key>
```

Keep the key private. API keys are personal credentials; they are not OAuth client IDs or client
secrets. Apps that cannot ask you to confirm changes cannot use **Ask before each change**; pick
**Read only** or **Allow changes without asking** for their keys.

## Review and revoke access

**Settings → Access** lists connected apps and API keys with their access level and when they were
last used. Choose **Revoke** to cut off an app or key. A key stops working immediately. A revoked
app cannot renew its access and loses it within 15 minutes.

## Make your server reachable

The instance operator is responsible for making Ryot reachable from the AI app. A private LAN
address may work for a locally running client but will not be reachable from a hosted AI service.
Configure an HTTPS address, reverse proxy, tunnel, or VPN as appropriate for your client. The AI app
must be able to reach both `/api/mcp` and the OAuth discovery and authentication endpoints.

Set `FRONTEND_URL` to the exact externally reachable Ryot origin. See
[Authentication](./authentication.md) for configuration and HTTPS requirements. A VPN such as
Tailscale helps only when the client making the connection can use that VPN.

Client support for remote MCP, custom headers, OAuth discovery, and dynamic registration varies.
Check your app's supported connection methods; an MCP URL alone does not guarantee compatibility.
