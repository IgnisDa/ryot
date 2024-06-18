# Installation

The docker image is `ignisda/ryot-pro`. Images are also available on the Github Container
Registry as `ghcr.io/ignisda/ryot-pro`.  If you would like to run the pro version, you need
to provide a `SERVER_PRO_KEY` environment variable. To see the features of the pro version,
check the [main website]({{ extra.main_website_url }}).

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
