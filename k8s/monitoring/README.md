# Monitoring

The backend serves Prometheus metrics on a dedicated port (`METRICS_PORT`,
default `9100`, `0` disables) separate from the API port, so the ingress never
routes to them. Metrics are held in process memory and scraped; nothing is
written to Postgres.

| File | Purpose |
|------|---------|
| `backend-podmonitor.yaml` | `PodMonitor` for kube-prometheus-stack; scrapes the `metrics` container port |
| `backend-networkpolicy.yaml` | Only the ingress controller may reach the API port, and only Prometheus the metrics port |
| `kustomization.yaml` | Puts both in `sts-prod` |

The backend Deployment (`k8s/base/backend.yaml`) labels its pods
`app.kubernetes.io/name: sts-backend` and names the container port `metrics`;
both resources select on those.

## Deploying

Needs kube-prometheus-stack (it provides the `PodMonitor` CRD) in a `monitoring`
namespace. The `PodMonitor`'s `release:` label must match your Helm release
name, since the stack's Prometheus only picks up monitors with that label.

```bash
kubectl apply -f argocd/monitoring-application.yaml
```

or, without Argo CD: `kubectl apply -k k8s/monitoring`.

The `NetworkPolicy` allows the ingress controller from the `traefik` namespace
(Helm install) and `kube-system` (K3s), and Prometheus from `monitoring`.
Adjust these to your cluster.
