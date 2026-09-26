# File Storage

Temporary files always use local storage. Permanent files use S3 when its configuration is complete;
otherwise, they use local storage. The server selects the provider.

## Temporary files

Uploads, imports, backup processing, and sandboxes use `/home/ryot/work` by default. Do not persist
this directory. Provide enough writable space for the largest operation.

## Permanent local storage

Without complete S3 configuration, mount a persistent volume at `/home/ryot/storage` and back it up.
The non-root backend user owns this directory and `/home/ryot/work`.

Local permanent storage is single-replica only. Use S3 if multiple backend replicas need to
share files.

### Docker Compose

Add a permanent volume to the `ryot` service. Do not mount `/home/ryot/work`:

```yaml
services:
  ryot:
    volumes:
      - ryot_local_storage:/home/ryot/storage
volumes:
  ryot_local_storage:
```

Back up `ryot_local_storage`.

## S3-compatible storage

Set the S3 endpoint, bucket, access key, and secret key. The region is optional.

For Cloudflare R2, create a bucket and an API token with read/write access, then set:

```sh
FILE_STORAGE_S3_BUCKET_NAME=ryot-storage
FILE_STORAGE_S3_ACCESS_KEY_ID=your-access-key-id
FILE_STORAGE_S3_SECRET_ACCESS_KEY=your-secret-access-key
FILE_STORAGE_S3_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
FILE_STORAGE_S3_REGION=auto
```

Use values from your provider. Complete S3 configuration removes the need for a persistent
`/home/ryot/storage` volume. If a required S3 value is missing, permanent files use local storage.
Temporary files always remain in `/home/ryot/work`.

## S3 CORS

Direct browser uploads use `PUT` with `Content-Type`. Add each exact frontend origin to bucket CORS:

```json
[
	{
		"AllowedOrigins": ["https://app.example.com", "https://localhost"],
		"AllowedMethods": ["PUT"],
		"AllowedHeaders": ["content-type"]
	}
]
```

## Uploads

1. Create an intent with `POST /uploads/intents`, specifying `temporary` or `permanent`. The
   server selects the provider.
2. Upload the bytes to the returned `uploadUrl` with the returned method and headers. S3 URLs
   are absolute provider URLs; local URLs are relative signed backend URLs.
3. Complete the intent with `POST /uploads/intents/:intentId/complete`.
4. Resolve a stored `local` or `s3` asset with `POST /uploads/downloads` when it needs to be
   displayed. Remote URLs do not use this endpoint.

Permanent completion returns a provider and key. Temporary completion returns a single-use token.
Completion can be retried safely.

## Limits and cleanup

- Regular uploads are limited to 50 MiB. Temporary backup archive uploads have a separate 1088 MiB
  limit.
- Upload intents and their upload targets expire 15 minutes after creation.
- A completed temporary upload is claimable for 15 minutes if it is not claimed.
- Claiming replaces that unclaimed lifetime with a 24-hour processing lease.
- Cleanup normally runs every 5 minutes. It removes abandoned temporary data within one additional
  interval and retries failed deletions.

Permanent local storage must be persistent; the working directory is disposable working space.
