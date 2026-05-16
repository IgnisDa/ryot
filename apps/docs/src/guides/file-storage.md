# File Storage

Ryot supports local storage and S3-compatible storage. The server selects the provider when it
creates an upload intent; clients do not choose a provider. Temporary files always use local
storage. Permanent files prefer S3 when its configuration is complete and otherwise use local
storage.

## Required signing secret

`FILE_STORAGE_LOCAL_SIGNING_SECRET` is required on every Ryot deployment, including deployments
that use S3 for permanent files. Use a long, random, dedicated secret and keep it stable across
restarts:

```sh
FILE_STORAGE_LOCAL_SIGNING_SECRET=replace-with-a-long-random-secret
```

## Temporary files

Temporary uploads, imports, backup archives while they are being processed, and sandbox working
files always use local storage. The default working directory is `/home/ryot/work`. It is
ephemeral working space: do not mount it as persistent storage, and make sure the deployment has
enough writable space for the largest operation.

## Permanent local storage

If S3 is not fully configured, Ryot falls back to local storage for permanent files. The container
uses `/home/ryot/storage` for these files. Mount a persistent volume there and include that volume
in your backups.

The container uses these directories by default, created and owned by the non-root backend user:

- `/home/ryot/storage` for permanent files.
- `/home/ryot/work` for temporary uploads, imports, backups, and sandbox files.

Local permanent storage is single-replica only. Use S3 if multiple backend replicas need to
share files.

### Docker Compose

For the local fallback, add a persistent volume for permanent files to the `ryot` service. Do not
mount `/home/ryot/work`:

```yaml
services:
  ryot:
    environment:
      FILE_STORAGE_LOCAL_SIGNING_SECRET: replace-with-a-long-random-secret
    volumes:
      - ryot_local_storage:/home/ryot/storage
volumes:
  ryot_local_storage:
```

Back up `ryot_local_storage`. The default working directory remains disposable container storage.

## S3-compatible storage

S3 is the preferred permanent storage provider. Ryot uses it when the S3 endpoint, bucket, access
key, and secret key are configured. The region is optional.

For Cloudflare R2, create a bucket and an API token with read/write access to that bucket. Then
set:

```sh
FILE_STORAGE_S3_BUCKET_NAME=ryot-storage
FILE_STORAGE_S3_ACCESS_KEY_ID=your-access-key-id
FILE_STORAGE_S3_SECRET_ACCESS_KEY=your-secret-access-key
FILE_STORAGE_S3_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
FILE_STORAGE_S3_REGION=auto
```

Replace the endpoint, bucket, region, and credentials with the values for your S3-compatible
provider. With complete S3 configuration, permanent files use S3 and do not need a persistent
`/home/ryot/storage` volume. Temporary files still use the local `/home/ryot/work` directory.
If any S3 value is missing, permanent files use local storage instead and require the persistent
volume described above.

## S3 CORS

When Ryot selects S3 for a permanent upload, the direct browser upload uses `PUT` with the
`Content-Type` header. Add the exact origins used by your Ryot frontend to the bucket CORS policy:

```json
[
	{
		"AllowedOrigins": ["https://app.example.com"],
		"AllowedMethods": ["PUT"],
		"AllowedHeaders": ["content-type"]
	}
]
```

## Uploads

The upload flow is:

1. Create an intent with `POST /uploads/intents`, specifying `temporary` or `permanent`. The
   server selects the provider.
2. Upload the bytes to the returned `uploadUrl` with the returned method and headers. S3 URLs
   are absolute provider URLs; local URLs are relative signed backend URLs.
3. Complete the intent with `POST /uploads/intents/:intentId/complete`.
4. Resolve a stored `local` or `s3` asset with `POST /uploads/downloads` when it needs to be
   displayed. Remote URLs do not use this endpoint.

Permanent completion returns a provider and key. Temporary completion returns a single-use token
for the import or other consumer. Retrying completion is safe.

## Limits and cleanup

- Regular uploads are limited to 50 MiB. Temporary backup archive uploads have a separate 1088 MiB
  limit.
- Native downloads and browsers with a save-file picker stream the response. If a browser has no
  save-file picker, its non-streaming Blob fallback buffers the whole download and is limited to
  50 MiB.
- Upload intents and their upload targets expire 15 minutes after creation.
- A completed temporary upload is claimable for 15 minutes if it is not claimed.
- Claiming replaces that unclaimed lifetime with a 24-hour processing lease.
- Cleanup runs in the existing frequent cron task, normally every 5 minutes, and removes
  abandoned temporary data within one additional cron interval. Failed deletions are retried.

Permanent local storage must be persistent; the working directory is disposable working space.
