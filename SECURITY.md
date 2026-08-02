# Security Policy

## Reporting a vulnerability

Please use GitHub's private security advisory feature for this repository. Do not include live API credentials, private endpoints, or unredacted configuration files in a public issue.

## Local credential storage

The manager stores provider credentials locally in `providers.json` and writes them into the generated OpenCode configuration when required by the selected provider adapter. These files are excluded by the included `.gitignore`.

The project does not include telemetry. Network requests are limited to configured provider model-list endpoints and the optional Models.dev metadata catalog.
