# File Storage

Ryot supports file storage and exporting using S3-compatible services.

## Cloudflare R2

You can configure Ryot to use [Cloudflare R2](https://developers.cloudflare.com/r2) for
file storage and exporting. R2 is S3-compatible and offers zero egress fees, making it a
cost-effective solution for production use.

### Prerequisites

- A Cloudflare account
- R2 subscription (available in the Cloudflare dashboard)

### Setup Instructions

- Log into the [Cloudflare dashboard](https://dash.cloudflare.com) and navigate to the R2
  section.
- Click "Create bucket" and provide a name for your bucket (e.g., `ryot-storage`).
- Go to "Manage R2 API tokens" and click "Create API token".
- Configure the token with the following settings:
  - **Permission**: Choose "Object Read & Write" for full access
  - **Resources**: Select "Apply to specific buckets" and choose your created bucket
- Click "Create API token" and copy both the **Access Key ID** and **Secret Access Key**.
- Note your **Account ID** from the R2 dashboard (found in the right sidebar).
- On your Ryot instance, set the following environment variables:

    ```sh
    FILE_STORAGE_S3_BUCKET_NAME=ryot-storage
    FILE_STORAGE_S3_ACCESS_KEY_ID=your-access-key-id
    FILE_STORAGE_S3_SECRET_ACCESS_KEY=your-secret-access-key
    FILE_STORAGE_S3_URL=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
    FILE_STORAGE_S3_REGION=auto # optional: some clients require a region; use "auto" for R2
    ```

  Replace `<ACCOUNT_ID>` with your Cloudflare account ID. Use the actual values for your
  bucket name and API credentials.

### CORS Configuration

To allow your Ryot instance to upload files directly from the browser, you need to configure
CORS settings for your R2 bucket:

- In the Cloudflare R2 dashboard, select your bucket.
- Navigate to the **Settings** tab.
- Scroll to the **CORS Policy** section and click **Edit**.
- Add the following configuration (adjust the origins to match your Ryot instance URLs):

    ```json
    [
      {
        "AllowedOrigins": [
          "https://app.ryot.io",
          "https://pro.ryot.io"
        ],
        "AllowedMethods": [
          "PUT"
        ],
        "AllowedHeaders": [
          "content-type"
        ]
      }
    ]
    ```
