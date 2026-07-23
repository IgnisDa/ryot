{{/*
Expand the name of the chart.
*/}}
{{- define "ryot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ryot.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version as used by the chart label.
*/}}
{{- define "ryot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ryot.labels" -}}
helm.sh/chart: {{ include "ryot.chart" . }}
{{ include "ryot.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ryot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ryot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Image tag, defaulting to the chart appVersion.
*/}}
{{- define "ryot.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end }}

{{/*
Name of the chart-managed application Secret (admin token, pro key, inline DB url).
*/}}
{{- define "ryot.secretName" -}}
{{ include "ryot.fullname" . }}
{{- end }}

{{/*
Name of the bundled Postgres resources. The base name is truncated to 54
characters so the "-postgres" suffix keeps the result within the 63-character
Kubernetes name limit.
*/}}
{{- define "ryot.postgres.fullname" -}}
{{ include "ryot.fullname" . | trunc 54 | trimSuffix "-" }}-postgres
{{- end }}

{{- define "ryot.postgres.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ryot.name" . }}-postgres
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: database
{{- end }}

{{/*
Name of the secret holding the bundled Postgres password.
*/}}
{{- define "ryot.postgres.secretName" -}}
{{- if .Values.postgres.auth.existingSecret -}}
{{ .Values.postgres.auth.existingSecret }}
{{- else -}}
{{ include "ryot.postgres.fullname" . }}
{{- end -}}
{{- end }}

{{/*
Key inside the Postgres password secret.
*/}}
{{- define "ryot.postgres.secretPasswordKey" -}}
{{- if .Values.postgres.auth.existingSecret -}}
{{ .Values.postgres.auth.existingSecretPasswordKey }}
{{- else -}}
postgres-password
{{- end -}}
{{- end }}

{{/*
Name of the secret that holds DATABASE_URL when using an external database.
*/}}
{{- define "ryot.database.secretName" -}}
{{- if .Values.externalDatabase.existingSecret -}}
{{ .Values.externalDatabase.existingSecret }}
{{- else -}}
{{ include "ryot.secretName" . }}
{{- end -}}
{{- end }}

{{/*
Key inside the external-database secret that holds DATABASE_URL.
*/}}
{{- define "ryot.database.secretKey" -}}
{{- if .Values.externalDatabase.existingSecret -}}
{{ .Values.externalDatabase.existingSecretKey }}
{{- else -}}
database-url
{{- end -}}
{{- end }}

{{/*
External database: true when neither a full url nor a full-url existing secret
is given, so the connection string is built from individual components.
*/}}
{{- define "ryot.externalDb.componentMode" -}}
{{- if and (not .Values.externalDatabase.url) (not .Values.externalDatabase.existingSecret) -}}
true
{{- end -}}
{{- end }}

{{/*
Render a single env var for an external-database component.
Args (dict): "name" envVarName, "cfg" component object, "secretName" / "secretKey"
chart-secret fallback (only used when sensitive), "sensitive" bool.
*/}}
{{- define "ryot.dbComponentEnv" -}}
{{- $cfg := .cfg -}}
- name: {{ .name }}
{{- if $cfg.existingSecret }}
  valueFrom:
    secretKeyRef:
      name: {{ $cfg.existingSecret }}
      key: {{ $cfg.existingSecretKey }}
{{- else if and .sensitive .secretName }}
  valueFrom:
    secretKeyRef:
      name: {{ .secretName }}
      key: {{ .secretKey }}
{{- else }}
  value: {{ $cfg.value | quote }}
{{- end }}
{{- end }}

{{/*
Name of the secret holding SERVER_ADMIN_ACCESS_TOKEN.
*/}}
{{- define "ryot.adminToken.secretName" -}}
{{- if .Values.secret.adminAccessToken.existingSecret -}}
{{ .Values.secret.adminAccessToken.existingSecret }}
{{- else -}}
{{ include "ryot.secretName" . }}
{{- end -}}
{{- end }}

{{- define "ryot.adminToken.secretKey" -}}
{{- if .Values.secret.adminAccessToken.existingSecret -}}
{{ .Values.secret.adminAccessToken.existingSecretKey }}
{{- else -}}
SERVER_ADMIN_ACCESS_TOKEN
{{- end -}}
{{- end }}

{{/*
Name of the secret holding SERVER_PRO_KEY.
*/}}
{{- define "ryot.proKey.secretName" -}}
{{- if .Values.secret.proKey.existingSecret -}}
{{ .Values.secret.proKey.existingSecret }}
{{- else -}}
{{ include "ryot.secretName" . }}
{{- end -}}
{{- end }}

{{- define "ryot.proKey.secretKey" -}}
{{- if .Values.secret.proKey.existingSecret -}}
{{ .Values.secret.proKey.existingSecretKey }}
{{- else -}}
SERVER_PRO_KEY
{{- end -}}
{{- end }}

{{/*
Whether SERVER_PRO_KEY is configured (inline or via existing secret).
*/}}
{{- define "ryot.proKey.enabled" -}}
{{- if or .Values.secret.proKey.value .Values.secret.proKey.existingSecret -}}
true
{{- end -}}
{{- end }}

{{/*
Database environment variables (shared by the Deployment and the helm test
pod). Emits the POSTGRES_* / RYOT_DB_* helper vars plus DATABASE_URL. The URL is
composed at runtime via $(VAR) interpolation so secret-sourced passwords are
never written into the manifest literal.
*/}}
{{- define "ryot.databaseEnv" -}}
{{- if .Values.postgres.enabled }}
- name: POSTGRES_USER
  value: {{ .Values.postgres.auth.username | quote }}
- name: POSTGRES_DB
  value: {{ .Values.postgres.auth.database | quote }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "ryot.postgres.secretName" . }}
      key: {{ include "ryot.postgres.secretPasswordKey" . }}
- name: DATABASE_URL
  value: "postgres://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@{{ include "ryot.postgres.fullname" . }}:{{ .Values.postgres.service.port }}/$(POSTGRES_DB)"
{{- else if include "ryot.externalDb.componentMode" . }}
{{- $db := .Values.externalDatabase }}
{{- include "ryot.dbComponentEnv" (dict "name" "RYOT_DB_HOST" "cfg" $db.host "sensitive" false) | nindent 0 }}
{{- include "ryot.dbComponentEnv" (dict "name" "RYOT_DB_PORT" "cfg" $db.port "sensitive" false) | nindent 0 }}
{{- include "ryot.dbComponentEnv" (dict "name" "RYOT_DB_NAME" "cfg" $db.database "sensitive" false) | nindent 0 }}
{{- include "ryot.dbComponentEnv" (dict "name" "RYOT_DB_USER" "cfg" $db.username "sensitive" false) | nindent 0 }}
{{- include "ryot.dbComponentEnv" (dict "name" "RYOT_DB_PASSWORD" "cfg" $db.password "sensitive" true "secretName" (include "ryot.secretName" .) "secretKey" "database-password") | nindent 0 }}
- name: DATABASE_URL
  value: "postgres://$(RYOT_DB_USER):$(RYOT_DB_PASSWORD)@$(RYOT_DB_HOST):$(RYOT_DB_PORT)/$(RYOT_DB_NAME)"
{{- else }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "ryot.database.secretName" . }}
      key: {{ include "ryot.database.secretKey" . }}
{{- end }}
{{- end }}

{{/*
Validate a {value, existingSecret, existingSecretKey} block. Args (dict):
  "field" path for messages, "cfg" the block, "required" bool.
Fails if required and neither value nor existingSecret is set, or if an
existingSecret is set without an existingSecretKey.
*/}}
{{- define "ryot.assertSecretRef" -}}
{{- $f := .field -}}
{{- $cfg := .cfg -}}
{{- if $cfg.existingSecret -}}
{{- if not $cfg.existingSecretKey -}}
{{- fail (printf "%s.existingSecretKey is required when %s.existingSecret is set" $f $f) -}}
{{- end -}}
{{- else if and .required (not $cfg.value) -}}
{{- fail (printf "%s.value or %s.existingSecret is required" $f $f) -}}
{{- end -}}
{{- end }}

{{/*
Validation: fail fast on missing or inconsistent required configuration.
*/}}
{{- define "ryot.validate" -}}
{{- /* Image */ -}}
{{- if not .Values.image.repository -}}
{{- fail "image.repository is required" -}}
{{- end -}}
{{- /* Service */ -}}
{{- if not .Values.service.port -}}
{{- fail "service.port is required" -}}
{{- end -}}
{{- /* SERVER_ADMIN_ACCESS_TOKEN (required) */ -}}
{{- include "ryot.assertSecretRef" (dict "field" "secret.adminAccessToken" "cfg" .Values.secret.adminAccessToken "required" true) -}}
{{- /* SERVER_PRO_KEY (optional, but secret ref must be consistent) */ -}}
{{- include "ryot.assertSecretRef" (dict "field" "secret.proKey" "cfg" .Values.secret.proKey "required" false) -}}
{{- /* Database */ -}}
{{- if .Values.postgres.enabled -}}
{{- if not .Values.postgres.image.repository -}}
{{- fail "postgres.image.repository is required when postgres.enabled is true" -}}
{{- end -}}
{{- if not .Values.postgres.image.tag -}}
{{- fail "postgres.image.tag is required when postgres.enabled is true" -}}
{{- end -}}
{{- if not .Values.postgres.auth.username -}}
{{- fail "postgres.auth.username is required when postgres.enabled is true" -}}
{{- end -}}
{{- if not .Values.postgres.auth.database -}}
{{- fail "postgres.auth.database is required when postgres.enabled is true" -}}
{{- end -}}
{{- if not (or .Values.postgres.auth.password .Values.postgres.auth.existingSecret) -}}
{{- fail "postgres.enabled is true: set a strong postgres.auth.password or reference one via postgres.auth.existingSecret. The chart ships no default password." -}}
{{- end -}}
{{- if and .Values.postgres.auth.existingSecret (not .Values.postgres.auth.existingSecretPasswordKey) -}}
{{- fail "postgres.auth.existingSecretPasswordKey is required when postgres.auth.existingSecret is set" -}}
{{- end -}}
{{- if not .Values.postgres.service.port -}}
{{- fail "postgres.service.port is required when postgres.enabled is true" -}}
{{- end -}}
{{- if .Values.postgres.persistence.enabled -}}
{{- if not .Values.postgres.persistence.size -}}
{{- fail "postgres.persistence.size is required when postgres.persistence.enabled is true" -}}
{{- end -}}
{{- if not .Values.postgres.persistence.mountPath -}}
{{- fail "postgres.persistence.mountPath is required when postgres.persistence.enabled is true" -}}
{{- end -}}
{{- end -}}
{{- else -}}
{{- /* External database (postgres.enabled is false) */ -}}
{{- $db := .Values.externalDatabase -}}
{{- if $db.url -}}
{{- /* full url inline: ok */ -}}
{{- else if $db.existingSecret -}}
{{- if not $db.existingSecretKey -}}
{{- fail "externalDatabase.existingSecretKey is required when externalDatabase.existingSecret is set" -}}
{{- end -}}
{{- else -}}
{{- /* component mode: every part required (port has a default) */ -}}
{{- include "ryot.assertSecretRef" (dict "field" "externalDatabase.host" "cfg" $db.host "required" true) -}}
{{- include "ryot.assertSecretRef" (dict "field" "externalDatabase.port" "cfg" $db.port "required" true) -}}
{{- include "ryot.assertSecretRef" (dict "field" "externalDatabase.database" "cfg" $db.database "required" true) -}}
{{- include "ryot.assertSecretRef" (dict "field" "externalDatabase.username" "cfg" $db.username "required" true) -}}
{{- include "ryot.assertSecretRef" (dict "field" "externalDatabase.password" "cfg" $db.password "required" true) -}}
{{- end -}}
{{- end -}}
{{- /* Dynamic secret env: reject chart-managed names. These are rendered
after the chart's own env entries, and Kubernetes lets the last duplicate
declaration win, so allowing them would silently override chart-managed
values. */ -}}
{{- $reserved := list "SERVER_ADMIN_ACCESS_TOKEN" "SERVER_PRO_KEY" "DATABASE_URL" "POSTGRES_USER" "POSTGRES_DB" "POSTGRES_PASSWORD" "RYOT_DB_HOST" "RYOT_DB_PORT" "RYOT_DB_NAME" "RYOT_DB_USER" "RYOT_DB_PASSWORD" -}}
{{- range $key, $_ := .Values.secretEnv -}}
{{- if has $key $reserved -}}
{{- fail (printf "secretEnv.%s: this env var is chart-managed and cannot be set via secretEnv" $key) -}}
{{- end -}}
{{- end -}}
{{- range $key, $_ := .Values.secretEnvFrom -}}
{{- if has $key $reserved -}}
{{- fail (printf "secretEnvFrom.%s: this env var is chart-managed and cannot be set via secretEnvFrom" $key) -}}
{{- end -}}
{{- end -}}
{{- /* Ingress */ -}}
{{- if .Values.ingress.enabled -}}
{{- if not .Values.ingress.hosts -}}
{{- fail "ingress.enabled is true: ingress.hosts must contain at least one entry" -}}
{{- end -}}
{{- range $i, $h := .Values.ingress.hosts -}}
{{- if not $h.host -}}
{{- fail (printf "ingress.hosts[%d].host is required" $i) -}}
{{- end -}}
{{- if not $h.paths -}}
{{- fail (printf "ingress.hosts[%d].paths must contain at least one entry" $i) -}}
{{- end -}}
{{- range $j, $p := $h.paths -}}
{{- if not $p.path -}}
{{- fail (printf "ingress.hosts[%d].paths[%d].path is required" $i $j) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end }}
