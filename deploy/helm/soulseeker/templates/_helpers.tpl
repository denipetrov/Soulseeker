{{- define "soulseeker.image" -}}
{{- required "image.tag is required: deploy with --set image.tag=<version>" .Values.image.tag | printf "%s:%s" .Values.image.repository -}}
{{- end -}}

{{- define "soulseeker.labels" -}}
app.kubernetes.io/name: soulseeker
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "soulseeker.selectorLabels" -}}
app.kubernetes.io/name: soulseeker
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: service
{{- end -}}

{{/*
The non-secret configuration, as a YAML map: the env file, with `envOverrides`
laid over it. Refuses to render if the file carries anything that belongs in a
Secret: the file is committed to git, and a credential pasted into it by
mistake should fail the deploy, not ship.
*/}}
{{- define "soulseeker.env" -}}
{{- $env := dict -}}
{{- $file := .Files.Get .Values.envFile -}}
{{- if not $file -}}
{{- fail (printf "envFile %q was not found inside the chart" .Values.envFile) -}}
{{- end -}}
{{- range $raw := splitList "\n" $file -}}
{{- $line := trim $raw -}}
{{- if and $line (not (hasPrefix "#" $line)) -}}
{{- if not (contains "=" $line) -}}
{{- fail (printf "%s: not a KEY=VALUE line: %q" $.Values.envFile $line) -}}
{{- end -}}
{{- $pair := splitn "=" 2 $line -}}
{{- $_ := set $env (trim $pair._0) (trim $pair._1) -}}
{{- end -}}
{{- end -}}
{{- range $key, $value := .Values.envOverrides -}}
{{- $_ := set $env $key (toString $value) -}}
{{- end -}}
{{- range $secret := list "BLIZZARD_CLIENT_ID" "BLIZZARD_CLIENT_SECRET" "RAIDER_IO_API_KEY" "MONGODB_URI" "REDIS_URL" "OIDC_JWKS" "OIDC_COOKIE_KEYS" "TURNSTILE_SECRET" -}}
{{- if hasKey $env $secret -}}
{{- fail (printf "%s must not be set in %s or envOverrides: it belongs in the Secret" $secret $.Values.envFile) -}}
{{- end -}}
{{- end -}}
{{- toYaml $env -}}
{{- end -}}

{{- define "soulseeker.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}

{{- define "soulseeker.podSecurity" -}}
runAsNonRoot: true
runAsUser: 1000
runAsGroup: 1000
seccompProfile:
  type: RuntimeDefault
{{- end -}}
