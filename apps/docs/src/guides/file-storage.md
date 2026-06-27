# File Storage

Ryot supports local storage, S3-compatible storage, or both at the same time. Choose the
provider per upload.

## Local storage

Use local storage when Ryot runs on one backend replica and has a persistent local volume.

The container uses two fixed directories, created and owned by the non-root backend user:

- `/home/ryot/storage` for permanent files.
- `/home/ryot/work` for temporary uploads, imports, and sandbox files.

The paths are not configurable. Only the signing secret must be set:

```sh
FILE_STORAGE_LOCAL_SIGNING_SECRET=replace-with-a-long-random-secret
```

Mount a persistent volume at `/home/ryot/storage` and back it up with your deployment.
`/home/ryot/work` is disposable and should not be included in permanent backups, but needs
enough capacity for uploads and imports. Use a dedicated signing secret, not an admin or S3
secret.

Local permanent storage is single-replica only. Use S3 if multiple backend replicas need to
share files.

### Docker Compose

Add a persistent volume for permanent files and disposable working storage to the `ryot`
service:

```yaml
services:
  ryot:
    environment:
      FILE_STORAGE_LOCAL_SIGNING_SECRET: replace-with-a-long-random-secret
    volumes:
      - ryot_local_storage:/home/ryot/storage
    tmpfs:
      - /home/ryot/work:uid=1001,gid=1001,mode=1770

volumes:
  ryot_local_storage:
```

Back up `ryot_local_storage`. The working directory is disposable.

## S3-compatible storage

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
provider. S3 and local configuration are independent, so both blocks can be enabled together.

## S3 CORS

Direct browser uploads use `PUT` with the `Content-Type` header. Add the exact origins used by
your Ryot frontend to the bucket CORS policy:

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

1. Create an intent with `POST /uploads/intents`, choosing `local` or `s3` and `temporary` or
   `permanent`.
2. Upload the bytes to the returned `uploadUrl` with the returned method and headers. S3 URLs
   are absolute provider URLs; local URLs are relative signed backend URLs.
3. Complete the intent with `POST /uploads/intents/:intentId/complete`.
4. Resolve a stored `local` or `s3` asset with `POST /uploads/downloads` when it needs to be
   displayed. Remote URLs do not use this endpoint.

Permanent completion returns a provider and key. Temporary completion returns a single-use token
for the import or other consumer. Retrying completion is safe.

## Limits and cleanup

- Uploads are limited to 50 MiB for both providers and both lifetimes.
- Upload intents and their upload targets expire 15 minutes after creation.
- A completed temporary upload is claimable for 15 minutes if it is not claimed.
- Claiming replaces that unclaimed lifetime with a 24-hour processing lease.
- Cleanup runs in the existing frequent cron task, normally every 5 minutes, and removes
  abandoned temporary data within one additional cron interval. Failed deletions are retried.

Permanent local storage must be persistent; the working directory is disposable working space.
