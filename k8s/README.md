# Kubernetes Deployment Guide

Support Ticketing System — production Kubernetes setup using Kustomize, Traefik, and ArgoCD.

> **Status**: Manifests implemented; not yet validated against a live cluster.
> See the [Kustomize Validation](#kustomize-validation) section before deploying.

> [!WARNING]
> **Frontend incomplete**: `frontend/package.json` has no `build` script and no
> application source. The frontend Docker image **cannot be built yet**.
> The backend and PostgreSQL can be deployed independently. The frontend
> Deployment and Service are included in the manifests for when the app is added.

## Monitoring

The backend serves Prometheus metrics on a dedicated port (`METRICS_PORT`,
default `9100`, `0` disables) separate from the API port, so the ingress never
routes to them. `monitoring/` holds a `PodMonitor` for kube-prometheus-stack and
a `NetworkPolicy` that only lets Prometheus reach that port. The backend
Deployment must label its pods `app.kubernetes.io/name: sts-backend` and name
the container port `metrics`. Metrics are held in process memory and scraped;
nothing is written to Postgres.

## Work remaining

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
   │                                        └──► Garage StatefulSet (ClusterIP: garage:3900)
   │
   └── /     ──► frontend (ClusterIP :3000)
```

| Component | Kind | Port | Notes |
|-----------|------|------|-------|
| `db` | StatefulSet + Service (ClusterIP) | 5432 | PostgreSQL 17, 2 Gi PVC |
| `garage` | StatefulSet + Service (ClusterIP) | 3900 | Garage S3-compatible object storage for ticket attachments, 5 Gi data PVC; only the backend may reach it |
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

Traefik's default router priority is the rule length, so `/api` takes priority
over `/`. Do not add `traefik.ingress.kubernetes.io/router.priority`: it applies
to every path of the Ingress, so both routers tie and `/api` can end up at the
frontend, which answers with a 502 from its Vite proxy.

---

## Directory Structure

```
k8s/
├── base/
│   ├── postgres.yaml          # StatefulSet + Service (db)
│   ├── garage.yaml            # StatefulSet + Service + NetworkPolicy (garage)
│   ├── garage.toml            # Garage config, turned into a ConfigMap
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
├── application.yaml           # ArgoCD Application definition
└── image-updater.yaml         # Image Updater: rolls out new sha-* images
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
| Argo CD Image Updater ≥ 1.0 | Rolls out new images (uses `ImageUpdater` resources) |

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
- `sha-<7-char-commit-sha>` — immutable; Argo CD Image Updater deploys the
  newest one (see [ArgoCD Installation](#argocd-installation-and-application-setup))
- `latest` — always points to the most recent main-branch build; only the
  bootstrap value in the production overlay

### Manual build (local testing only)

> [!WARNING]
> The **frontend image cannot currently be built** — `frontend/package.json`
> has no `build` script and no application source. Build only the backend:

```bash
# Backend only (frontend build will fail until app code is added)
docker build -t sts-backend:local ./backend --target production
```

For a local cluster (e.g. K3s), import images with:
```bash
docker save sts-backend:local | sudo k3s ctr images import -
```

---

## Secrets Setup

See [`k8s/secrets.md`](./secrets.md) for full details.

**Quick bootstrap:**
```bash
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 20)
ADMIN_EMAIL=admin@example.com            # change to the real admin address
ADMIN_PASSWORD=$(openssl rand -hex 16)   # note it down: it is not shown again
S3_ACCESS_KEY="GK$(openssl rand -hex 16)"
S3_SECRET_KEY=$(openssl rand -hex 32)
GARAGE_RPC_SECRET=$(openssl rand -hex 32)

kubectl create namespace sts-prod --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic sts-secrets \
  --namespace=sts-prod \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=DB_NAME=sts \
  --from-literal=DB_USER=sts \
  --from-literal=DB_PASSWORD="${DB_PASSWORD}" \
  --from-literal=ADMIN_EMAIL="${ADMIN_EMAIL}" \
  --from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  --from-literal=S3_ACCESS_KEY="${S3_ACCESS_KEY}" \
  --from-literal=S3_SECRET_KEY="${S3_SECRET_KEY}" \
  --from-literal=GARAGE_RPC_SECRET="${GARAGE_RPC_SECRET}"
```

> JWT_SECRET must be ≥ 32 characters — the backend will refuse to start otherwise.
> ADMIN_EMAIL and ADMIN_PASSWORD (≥ 12 characters) are required too: on an empty
> database the backend creates the first admin from them and refuses to start
> without them.
> S3_ACCESS_KEY (`GK` + 32 hex characters), S3_SECRET_KEY and GARAGE_RPC_SECRET
> (64 hex characters each) must have exactly these formats: Garage creates the
> access key and the `sts-attachments` bucket from them on first start, and the
> backend uses the same key to store attachments.

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

ArgoCD will now watch `main` at `k8s/overlays/production`. Until Image Updater
is set up (next step) the workloads run the overlay's bootstrap `latest` tag.

### 4. Install Argo CD Image Updater

CI only builds and pushes images; it does not touch git or the cluster.
Image Updater runs next to Argo CD, polls GHCR (about every two minutes) and
sets the newest immutable `sha-*` tag on the Application, so a push to `main`
rolls out without any credentials for the cluster in GitHub.

```bash
# Same namespace as Argo CD, so the default scope covers the Application.
# Pin a release (>= 1.0) instead of `stable` for repeatable installs.
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/stable/config/install.yaml
kubectl -n argocd rollout status deploy/argocd-image-updater-controller

# Tell it which Application and images to track
kubectl apply -f argocd/image-updater.yaml
```

If the GHCR packages are private, create a pull secret with a token that has
`read:packages`, and uncomment the `pullSecret` lines in
`argocd/image-updater.yaml`:

```bash
kubectl create -n argocd secret docker-registry ghcr-creds \
  --docker-server=ghcr.io \
  --docker-username=<github-user> \
  --docker-password=<token-with-read:packages>
```

The cluster pods need to pull the images too: public packages need nothing,
private ones need an `imagePullSecret` in `sts-prod`.

Check that it works:

```bash
kubectl -n argocd logs deploy/argocd-image-updater-controller | tail
kubectl -n argocd get imageupdater support-ticketing-system -o yaml   # see status
kubectl -n argocd get application support-ticketing-system \
  -o jsonpath='{.spec.source.kustomize.images}'; echo
```

The override lives on the Application resource, not in git. Re-applying
`argocd/application.yaml` removes it until the next poll.

---

## Deployment Verification

After ArgoCD syncs (or after a manual `kubectl apply -k k8s/overlays/production`):

```bash
# All pods should be Running
kubectl -n sts-prod get pods

# Check that all Deployments are available
kubectl -n sts-prod get deployments

# Verify StatefulSet
kubectl -n sts-prod get statefulset postgres garage

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
garage-0              1/1     Running   0          2m
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
- Cannot reach `garage:3900` — the backend creates the attachment bucket on
  startup, so Garage must be Ready (`kubectl -n sts-prod logs sts/garage`) and
  `S3_ACCESS_KEY` / `S3_SECRET_KEY` must exist in `sts-secrets`. Uploads return
  503 if the backend runs without `S3_ENDPOINT`.

### Attachment uploads fail
Uploads are limited to 10 MB (`MAX_UPLOAD_BYTES`) and to PNG, JPEG, GIF, WebP
and PDF. Anything above the backend (a proxy body limit) shows up as a 413 that
does not come from the API. Files are only served through
`GET /api/v1/tickets/{id}/attachments/{id}/content`; Garage has no Ingress. To
look inside the bucket, port-forward `sts/garage` 3900 and point any S3 client
(e.g. `aws s3 ls --endpoint-url http://localhost:3900`, region `garage`) at it
with the `S3_*` credentials.

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

### New images are not rolled out
Push to `main`, wait for the workflow to push the images, then check:
```bash
kubectl -n argocd logs deploy/argocd-image-updater-controller | grep support-ticketing
```
Common causes: the GHCR packages are private and no `pullSecret` is set, the
`ImageUpdater` is not in the same namespace as the Application (`argocd`), or
the tag does not match `^sha-[0-9a-f]{7}$`.

---

## Smoke Tests

> Run these only after confirming pods are `Running` and the Ingress is active.
> Replace `<CLUSTER_IP>` with the external IP of the Traefik LoadBalancer or
> use `localhost` if port-forwarding.

```bash
# Backend reached through the /api rule: no token, so 401 (not 404/502)
curl -o /dev/null -w "%{http_code}" http://<CLUSTER_IP>/api/v1/auth/me
# Expected: 401
# (FastAPI serves /openapi.json at the root, which the /api rule does not route;
#  the pod probes check it directly on port 8000.)

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
