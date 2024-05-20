# Installation

The docker image is `ghcr.io/ignisda/ryot:latest` or `ghcr.io/ignisda/ryot-pro:latest`. If
you would like to run the pro version, you need to provide a `SERVER_PRO_KEY` environment
variable. To see the features of the pro version, check the [main website]({{
extra.main_website_url }}).

```yaml
services:
  ryot-db:
    image: postgres:16-alpine # atleast version 15 is required
    restart: unless-stopped
    volumes:
      - postgres_storage:/var/lib/postgresql/data
    environment:
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_DB=postgres
    container_name: ryot-db

  ryot:
    image: ghcr.io/ignisda/ryot:latest # or ghcr.io/ignisda/ryot-pro:latest
    environment:
      - DATABASE_URL=postgres://postgres:postgres@ryot-db:5432/postgres
      # - SERVER_PRO_KEY=your_pro_key # only for ryot-pro
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
