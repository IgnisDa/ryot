# Pro Key Verification

Ryot verifies `SERVER_PRO_KEY` through its hosted verification service.

## Verification

Ryot sends the key to `https://ryot.io/api/pro-key/verify`. It checks the result and any expiry date, then
caches the result in the server process.

The cache lasts one hour and is cleared at server restart. [Pro features](https://ryot.io/features)
can remain active for up to one hour after a subscription expires.

## Failure behavior

| Scenario                          | Behavior                                      |
| --------------------------------- | --------------------------------------------- |
| No `SERVER_PRO_KEY` provided      | Community version                             |
| Invalid key                       | Community version (with warning log)          |
| Expired subscription              | Community version (with warning log)          |
| Unreadable expiry date            | Community version (with warning log)          |
| Network error during verification | Community version (verification fails safely) |
| Verification service unavailable  | Community version (verification fails safely) |

Pro and community data are compatible. Update the key and restart the server to switch versions.

## Troubleshooting

1. Set `SERVER_LOG_LEVEL=debug` and inspect the file or OTLP logs.
2. Check `SERVER_PRO_KEY` for spaces or unwanted quotes.
3. Check the subscription on the [Ryot website](https://ryot.io).
4. Restart the server after renewal to clear the cached result.

## Privacy

The instance sends only its license key to Ryot’s verifier, which checks it with Unkey.
