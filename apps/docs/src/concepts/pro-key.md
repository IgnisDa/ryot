# Pro Key Verification

Ryot uses [Unkey](https://unkey.com) to verify Pro license keys. This page explains how
the verification process works and what happens when verification fails.

## How It Works

When you provide a `SERVER_PRO_KEY` environment variable, Ryot verifies it using the
following process:

1. **API Call**: Ryot sends a verification request to Unkey's API
   (`https://api.unkey.com/v2/keys.verifyKey`)
2. **Response Check**: Unkey responds with whether the key is valid and optionally an
   expiry date
3. **Expiry Validation**: If the key has an expiry date, Ryot checks if the subscription
   is still active
4. **Result Caching**: The verification result is cached to avoid repeated API calls

## Caching Behavior

- The verification result is cached for **1 hour**
- The cache is **invalidated on server restart** (verification happens fresh on each start)
- This means Pro features will remain active for up to 1 hour even if your subscription
  expires mid-session

## Fallback Behavior

Ryot gracefully falls back to the community version in these scenarios:

| Scenario                          | Behavior                                      |
| --------------------------------- | --------------------------------------------- |
| No `SERVER_PRO_KEY` provided      | Community version                             |
| Invalid key                       | Community version (with warning log)          |
| Expired subscription              | Community version (with warning log)          |
| Network error during verification | Community version (verification fails safely) |
| Unkey API unavailable             | Community version (verification fails safely) |

Since the Pro and community versions are fully compatible, you can switch between them at
any time by simply updating the environment variable and restarting the server.

## Troubleshooting

If Pro features are not working as expected:

1. **Check the logs**: Enable debug logging with `RUST_LOG=ryot=debug` to see verification
   messages

2. **Verify your key**: Ensure the `SERVER_PRO_KEY` environment variable is set correctly
   with no extra spaces or quotes

3. **Check your subscription**: Log into the [Ryot website](https://ryot.io) to verify
   your subscription status

4. **Restart the server**: If you recently renewed your subscription, restart the server
   to clear the cached verification result

## Privacy

The verification process only sends your license key to Unkey's API. No other data about
your Ryot instance or usage is transmitted during verification.
