# Connect an AI app with MCP

Ryot exposes a remote MCP server at:

```text
<FRONTEND_URL>/api/mcp
```

Choose **Streamable HTTP** in an AI app that supports remote MCP servers. For example, if your Ryot
address is `https://ryot.example`, enter `https://ryot.example/api/mcp`.

The connection acts as your Ryot account. It can read your data and use the operations exposed by
your installed plugins, including operations that change or delete data. Review requests in your AI
app before approving them.

## Connect with an API key

If you have a personal Ryot API key, configure the MCP connection to send this header on every
request:

```text
X-Api-Key: <your-api-key>
```

Keep the key private. API keys are personal credentials; they are not OAuth client IDs or client
secrets.

Ryot currently has no API-key management screen. For setup through an API, use a signed-in hosted
browser session to send `POST /api/auth/api-key/create` with a JSON body such as:

```json
{ "name": "My MCP client", "expiresIn": 2592000 }
```

This example expires after 30 days. Save the response's `key` in your MCP client and keep its `id`
for revocation. To revoke it, send `POST /api/auth/api-key/delete` with `{ "keyId": "<id>" }` using
the hosted session. These management endpoints require Ryot's hosted session cookie; an API access
token is not a substitute. Use OAuth below for an interactive setup that does not require managing
keys through an API.

## Connect with OAuth

Enter the MCP endpoint URL in an app that supports OAuth discovery and public-client dynamic
registration. The app discovers Ryot's authorization server and registers itself without a client
secret. Ryot supports the authorization code flow with S256 PKCE for these public clients.

When the app opens your browser:

1. Sign in to your Ryot server with your usual password or identity provider. Complete two-factor
   authentication if prompted.
2. Check the registered app name and the redirect origin shown on the consent page. App names are
   supplied during registration; Ryot does not verify the publisher.
3. Review the `ryot:api` permission. It grants access to your Ryot API, including reads and changes;
   there is no separate read-only permission.
4. Choose **Approve** to connect or **Deny** to return without granting access.

For clients that ask for the OAuth resource explicitly, use the same complete MCP endpoint URL:
`<FRONTEND_URL>/api/mcp`. Public clients use `token_endpoint_auth_method: none`; confidential-client
registration is not supported. Ryot's own web and mobile apps keep their existing sign-in flow.

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
