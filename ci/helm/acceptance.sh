#!/usr/bin/env bash
set -euo pipefail

kind load docker-image ryot-image:latest --name ryot-ci
values=(
  --namespace ryot
  --set image.repository=ryot-image
  --set image.tag=latest
  --set image.pullPolicy=Never
  --set secret.adminAccessToken.value=ci-admin-token-for-kubernetes-acceptance
  --set postgres.auth.password=ci-postgres-password
  --set config.frontendUrl=http://ryot.ci.local
  --wait --timeout 35m
)
helm install ryot ci/helm/ryot --create-namespace "${values[@]}"
helm test ryot --namespace ryot --logs
kubectl exec -n ryot deployment/ryot -- bun dist/prepare-sandbox-runtime.js
kubectl exec -n ryot deployment/ryot -- sh -ec 'printf retained > /home/ryot/storage/acceptance-marker'

kubectl delete pod -n ryot -l app.kubernetes.io/name=ryot,app.kubernetes.io/component!=database --wait=true
kubectl rollout status -n ryot deployment/ryot --timeout=10m
kubectl exec -n ryot deployment/ryot -- sh -ec 'test "$(cat /home/ryot/storage/acceptance-marker)" = retained'

helm upgrade ryot ci/helm/ryot "${values[@]}" --set config.disableTelemetry=true
helm test ryot --namespace ryot --logs
kubectl exec -n ryot deployment/ryot -- sh -ec 'test "$(cat /home/ryot/storage/acceptance-marker)" = retained'
kubectl exec -n ryot deployment/ryot -- bun dist/prepare-sandbox-runtime.js
kubectl exec -n ryot deployment/ryot -- rm /home/ryot/storage/acceptance-marker
