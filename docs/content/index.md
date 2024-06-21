# Installation

Images are also available on the Github Container Registry as `ghcr.io/ignisda/ryot-pro`.
If you would like to run the pro version, you need to provide a `SERVER_PRO_KEY`
environment variable. To see the features of the pro version, check the [features
page]({{extra.main_website_url }}/features).

```yaml
services:
  ryot-db:
    image: postgres:16-alpine # at-least version 15 is required
    restart: unless-stopped
    volumes:
      - postgres_storage:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_DB=postgres
    container_name: ryot-db

  ryot:
    image: ignisda/ryot-pro:latest # or ignisda/ryot:latest for the community version
    environment:
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
      - SERVER_PRO_KEY=<pro_key_issued_to_you> # if using the pro version
      # - FRONTEND_INSECURE_COOKIES=true # if running on HTTP
    ports:
      - "8000:8000"
    pull_policy: always
    container_name: ryot

volumes:
  postgres_storage:
```

!!! info

    The first user you register is automatically set as admin of the instance.

## Upgrading to Pro

To upgrade to the pro version, you need to provide a `SERVER_PRO_KEY` environment variable.
You can get a key by contacting us via the [main website]({{ extra.main_website_url }}).

Once you have the key, you can set it in the `docker-compose.yml` file as shown above.
Please note that the pro version is not backwards compatible with the community version, so
sure to backup your data before upgrading.
