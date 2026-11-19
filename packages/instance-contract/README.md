# Instance Contract

`@ryot-app/instance-contract` defines the HTTP interface shared by the website and a Ryot
instance. The website uses the account admin client to provision users, reset passwords, and
set account access. The full Ryot API extends the same account admin group with its other
instance-admin operations. The website's Pro-key verification endpoint and the instance that
calls it share the response schema here.

The package contains wire schemas and the typed HTTP client. It depends on Effect and can build
without kernel code, message catalogs, or the full application contract.
