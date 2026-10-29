# Kubernetes Deployment Guide

Support Ticketing System — production Kubernetes setup using Kustomize, Traefik,
ArgoCD and External Secrets Operator.

> **Status**: Manifests implemented; not yet validated against a live cluster.
> See the [Validation](#validation) section before deploying.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Request Routing](#request-routing)
3. [Directory Structure](#directory-structure)
4. [Prerequisites](#prerequisites)
5. [Traefik Installation](#traefik-installation)
6. [Image Building and Availability](#image-building-and-availability)
7. [Secrets Setup](#secrets-setup)
8. [Kustomize Validation](#kustomize-validation)
9. [ArgoCD Installation and Application Setup](#argocd-installation-and-application-setup)
10. [Deployment Verification](#deployment-verification)
11. [Troubleshooting](#troubleshooting)
12. [Smoke Tests](#smoke-tests)

---

## Architecture

```
Internet
   │
   ▼
Traefik (IngressClass: traefik)
   │
   ├── /api  ──► backend  (ClusterIP :8000) ──► PostgreSQL StatefulSet (ClusterIP: db:5432)
   │
   └── /     ──► frontend (ClusterIP :3000)
```

| Component | Kind | Port | Notes |
|-----------|------|------|-------|
| `db` | StatefulSet + Service (ClusterIP) | 5432 | PostgreSQL 17, 2 Gi PVC |
| `backend` | Deployment + Service (ClusterIP) | 8000 | FastAPI via uvicorn |
| `frontend` | Deployment + Service (ClusterIP) | 3000 | Node.js production server |
| `sts-ingress` | Ingress | — | Traefik routes `/api` and `/` |

All credentials are stored in the Secret `sts-secrets` (see [Secrets Setup](#secrets-setup)).

---

## Request Routing

Traefik handles all ingress. The routing rules defined in `k8s/base/ingress.yaml`:

- **`/api`** → `backend:8000`
  All FastAPI routes live under `/api/v1/` (e.g. `GET /api/v1/auth/token`).
  The `/api` prefix is **not stripped**; the backend expects it intact.

- **`/`** → `frontend:3000`
  All other requests go to the Node.js frontend server.

Traefik uses longest-prefix matching, so `/api` takes priority over `/`.
The annotation `traefik.ingress.kubernetes.io/router.priority: "10"` reinforces
this on the backend rule.

---

## Directory Structure

```
k8s/
├── base/
│   ├── postgres.yaml          # StatefulSet + Service (db)
│   ├── backend.yaml           # Deployment + Service (backend)
│   ├── frontend.yaml          # Deployment + Service (frontend)
│   ├── ingress.yaml           # Traefik Ingress
│   └── kustomization.yaml     # Base Kustomize manifest
├── overlays/
│   └── production/
│       └── kustomization.yaml # Sets namespace sts-prod and GHCR image tags
├── secrets.md                 # Secrets documentation (bootstrap + ESO)
└── README.md                  # This file

argocd/
└── application.yaml           # ArgoCD Application definition
```

---

## Prerequisites

| Requirement | Why |
|-------------|-----|
| Kubernetes ≥ 1.27 | `networking.k8s.io/v1` Ingress |
| `kubectl` | Apply manifests |
| `kustomize` ≥ 5 | Build overlays |
| Traefik v3 (IngressClass `traefik`) | Ingress controller |
| ArgoCD ≥ 2.10 | GitOps sync |
| Container images published to GHCR | See below |

---

## Traefik Installation

### Option A — K3s (recommended for single-node)

K3s ships with Traefik v2/v3 pre-installed and registers the `traefik`
IngressClass automatically. No additional steps are required.

```bash
curl -sfL https://get.k3s.io | sh -
# Traefik is running; verify:
kubectl get ingressclass traefik
```

### Option B — Helm (any cluster)

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update

helm install traefik traefik/traefik \
  --namespace traefik \
  --create-namespace \
  --set ingressClass.enabled=true \
  --set ingressClass.isDefaultClass=false \
  --set ports.web.exposedPort=80
```

Verify:
```bash
kubectl get ingressclass traefik
kubectl -n traefik get pods
```

> **Docker provider removed** — the existing `traefik/traefik.yml` uses the
> Docker socket provider, which only works in a Docker Compose environment.
> In Kubernetes, Traefik uses the Kubernetes Ingress provider automatically.

---

## Image Building and Availability

Images are published to GHCR by the GitHub Actions workflow
`.github/workflows/docker-build-push.yml` on every push to `main`.

| Service | GHCR image |
|---------|-----------|
| Backend | `ghcr.io/r-ethan18/support-ticketing-system-backend` |
| Frontend | `ghcr.io/r-ethan18/support-ticketing-system-frontend` |

Tags:
- `sha-<7-char-commit-sha>` — immutable, used by the production overlay
- `latest` — always points to the most recent main-branch build

### Manual build (local testing only)

```bash
docker build -t sts-backend:local ./backend --target production
docker build -t sts-frontend:local ./frontend --target production
```

For a local cluster (e.g. K3s), import images with:
```bash
docker save sts-backend:local | sudo k3s ctr images import -
docker save sts-frontend:local | sudo k3s ctr images import -
```

---

## Secrets Setup

See [`k8s/secrets.md`](./secrets.md) for full details.

**Quick bootstrap:**
```bash
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 20)

kubectl create namespace sts-prod --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic sts-secrets \
  --namespace=sts-prod \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=DB_NAME=sts \
  --from-literal=DB_USER=sts \
  --from-literal=DB_PASSWORD="${DB_PASSWORD}"
```

> JWT_SECRET must be ≥ 32 characters — the backend will refuse to start otherwise.

---

## Kustomize Validation

`kubectl kustomize` and standalone `kustomize` both render the overlay for
inspection without applying it to a cluster.

```bash
# Render the production overlay (requires kustomize or kubectl ≥ 1.21)
kubectl kustomize k8s/overlays/production

# Or with standalone kustomize
kustomize build k8s/overlays/production

# YAML syntax check using Python (no extra tools needed)
python3 -c "
import yaml, pathlib, sys
errors = []
for f in pathlib.Path('k8s').rglob('*.yaml'):
    try:
        list(yaml.safe_load_all(f.read_text()))
    except yaml.YAMLError as e:
        errors.append(f'{f}: {e}')
if errors:
    print('\\n'.join(errors)); sys.exit(1)
else:
    print('All YAML files parsed successfully')
"
```

---

## ArgoCD Installation and Application Setup

> **IMPORTANT**: Applying `argocd/application.yaml` only creates the ArgoCD
> Application object. It does not deploy your workloads unless ArgoCD is
> already installed and running in the cluster.

### 1. Install ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Wait for ArgoCD to be ready
kubectl -n argocd rollout status deploy/argocd-server
```

### 2. Access the ArgoCD UI

```bash
# Get the initial admin password
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo

# Port-forward the UI (dev only)
kubectl -n argocd port-forward svc/argocd-server 8080:443
# Open https://localhost:8080
```

### 3. Apply the Application

```bash
kubectl apply -f argocd/application.yaml
```

ArgoCD will now watch `main` at `k8s/overlays/production`. When the GitHub
Actions workflow commits updated image tags, ArgoCD detects the change and
synchronizes the cluster automatically.

---

## Deployment Verification

After ArgoCD syncs (or after a manual `kubectl apply -k k8s/overlays/production`):

```bash
# All pods should be Running
kubectl -n sts-prod get pods

# Check that all Deployments are available
kubectl -n sts-prod get deployments

# Verify StatefulSet
kubectl -n sts-prod get statefulset postgres

# Verify Ingress
kubectl -n sts-prod get ingress sts-ingress

# Check Services
kubectl -n sts-prod get services
```

Expected output:
```
NAME                  READY   STATUS    RESTARTS   AGE
backend-xxx           1/1     Running   0          2m
frontend-xxx          1/1     Running   0          2m
postgres-0            1/1     Running   0          2m
```

---

## Troubleshooting

### Pod stuck in `Pending`
```bash
kubectl -n sts-prod describe pod <pod-name>
```
Common causes: PVC not bound (no storage class), image pull error (check GHCR access).

### Backend exits immediately
```bash
kubectl -n sts-prod logs deploy/backend
```
Common causes:
- `JWT_SECRET` missing or shorter than 32 characters.
- Cannot reach `db:5432` — check that the `db` Service exists and the
  PostgreSQL pod is Ready.

### PostgreSQL readiness probe fails
The probe runs `pg_isready -U postgres -d postgres`. If you customised
`POSTGRES_USER` away from `postgres`, you need to update the probe command in
`k8s/base/postgres.yaml` to match. Currently the probe uses the PostgreSQL
default superuser because the readiness check runs before the custom user is
necessarily created, and `pg_isready` only checks that the server accepts
connections.

### 404 on `/api` routes
Check that Traefik is installed and the `traefik` IngressClass exists:
```bash
kubectl get ingressclass traefik
kubectl -n sts-prod describe ingress sts-ingress
```

### ArgoCD shows `OutOfSync`
```bash
argocd app diff support-ticketing-system
argocd app sync support-ticketing-system
```

### `[skip ci]` not working (infinite loop)
GitHub natively skips workflow runs whose head commit message contains
`[skip ci]`. If this is not being respected, check Actions settings under
**Settings → Actions → General**.

---

## Smoke Tests

> Run these only after confirming pods are `Running` and the Ingress is active.
> Replace `<CLUSTER_IP>` with the external IP of the Traefik LoadBalancer or
> use `localhost` if port-forwarding.

```bash
# Backend: OpenAPI schema (no auth required)
curl -f http://<CLUSTER_IP>/api/openapi.json | python3 -m json.tool | head -20

# Backend: auth token endpoint responds (400 without body is expected)
curl -o /dev/null -w "%{http_code}" \
  -X POST http://<CLUSTER_IP>/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{}'
# Expected: 422 (Unprocessable Entity — missing fields, not 404/502)

# Frontend: home page
curl -o /dev/null -w "%{http_code}" http://<CLUSTER_IP>/
# Expected: 200
```

> **Local testing vs production**: The smoke tests above work for both if
> Traefik is reachable. For local K3s, `<CLUSTER_IP>` is typically
> `127.0.0.1`; for a cloud cluster, use the LoadBalancer external IP from
> `kubectl -n traefik get svc`.
