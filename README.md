# Support Ticketing System (STS)

A comprehensive full-stack Support Ticketing System featuring a React.js frontend, FastAPI backend, PostgreSQL database, Garage (S3-compatible) object storage for ticket attachments, and Traefik reverse proxy.

---

## Architecture Overview

- **Frontend**: React.js application served on port `3000` (routed via Traefik reverse proxy).
- **Backend API**: Python FastAPI service exposing RESTful APIs under `/api` on port `8000`.
- **Database**: PostgreSQL 17 for relational storage.
- **Attachment Storage**: Garage S3-compatible distributed object storage.
- **Reverse Proxy**: Traefik v3 routing web traffic to frontend and backend services.
- **Prometheus + Grafana**: Monitoring System for backend as well as Kubernetes cluster
- **Deployment Options**: Docker Compose (local testing) or Kubernetes cluster (production).
---

## Prerequisites

Before starting, ensure you have the following installed on your machine:

- [Docker](https://docs.docker.com/get-docker/) (v20.10+ recommended)
- [Docker Compose](https://docs.docker.com/compose/) (v2.0+ recommended)

---

## Quickstart with Docker Compose

Follow these steps to launch the entire stack locally:

### 1. Clone the Repository

```bash
git clone https://github.com/r-ethan18/Support-Ticketing-System.git
cd Support-Ticketing-System
```

### 2. Configure Environment Variables

Create your local `.env` configuration file from `.env.example`:

```bash
cp .env.example .env
```

Review the values in the `.env` file. The default values in `.env.example` work out-of-the-box for local testing:

- **Admin Account**:
  - Email: `admin@example.com`
  - Password: `adminpassword123`
- **Postgres Database**: `sts` (user: `sts`, password: `stslocaldevpassword`)
- **Garage S3 & JWT Secrets**: Pre-filled test credentials for local environments.

> [!TIP]
> If you wish to regenerate random secrets for production or custom testing:
> ```bash
> # S3 Access Key: "GK" + 32 hex chars
> echo "GK$(openssl rand -hex 16)"
> # S3 Secret Key & Garage RPC Secret: 64 hex chars
> openssl rand -hex 32
> # JWT Secret: 32+ chars
> openssl rand -base64 32
> ```

### 3. Build and Start the Containers

Run the following command to build the Docker images and start all services in detached mode:

```bash
docker compose up -d --build
```

### 4. Verify Service Health

Check the status of running containers:

```bash
docker compose ps
```

All services (`sts-traefik`, `sts-backend`, `sts-frontend`, `sts-db`, and `sts-garage`) should report healthy or running status.

To inspect logs in real time:

```bash
# View all logs
docker compose logs -f

# View specific service logs (e.g., backend or frontend)
docker compose logs -f backend
docker compose logs -f frontend
```

---

### Service Endpoints & Access

Once started, the following services and interfaces are accessible:

| Service / Interface | URL | Description |
| :--- | :--- | :--- |
| **Web Application** | [http://localhost](http://localhost) | Main frontend interface |
| **Traefik Dashboard** | [http://localhost:8080/dashboard/](http://localhost:8080/dashboard/) | Traefik reverse proxy dashboard |

---

### Stopping the Application

To stop and remove containers and networks:

```bash
docker compose down
```

To stop containers and also remove persistent volumes (database data and attachment storage):

```bash
docker compose down -v
```

---

### Troubleshooting

- **Port Conflicts**: Ensure ports `80`, `8080`, `8000`, and `5433` are not in use by other local services.
- **Database Connection Issues**: The backend waits for the database healthcheck before starting. If containers fail to start, check PostgreSQL logs with `docker compose logs db`.
- **Environment Variable Errors**: If any required environment variable is missing, `docker compose` will raise an error pointing out the missing variable in `.env`. Ensure `.env` exists and has all keys populated.


## Kubernetes Deployment

The application supports automated GitOps deployment on Kubernetes using Argo CD, Argo CD Image Updater, and Ingress via Traefik. You can run on **K3s** (recommended for production servers / VMs) or **Kind** (Kubernetes in Docker for local development and testing).

---

### 1. Prerequisites & Dependencies

Install host-level dependencies (`kubectl`, `helm`, `kind`/`k3s`, `docker`, `argocd`, `jq`, `curl`, `git`, `openssl`). A helper script is provided for Ubuntu 24.04 LTS, Arch Linux, and NixOS:

```bash
./deploy/install-deps.sh
```

Ensure your `.env` configuration file is present in the repository root (see [Configure Environment Variables](#2-configure-environment-variables)):

```bash
cp .env.example .env
```

> [!NOTE]
> If specific credentials are not defined in `.env`, the deployment script will automatically generate cryptographically secure values and persist them safely inside the Kubernetes Secret `sts-secrets` in the cluster.

---

### 2. Start the Kubernetes Cluster

Use `init-cluster.sh` to initialize your chosen cluster environment:

#### Option A: Production K3s Cluster (Recommended for Servers & VMs)

Installs a lightweight CNCF-certified Kubernetes distribution managed as a systemd service, configured with default `local-path` persistent storage and Traefik Ingress:

```bash
# Optional: specify public IP or hostname for TLS SANs if deploying to a remote host
# export K3S_TLS_SANS="<your-server-ip>"

./deploy/init-cluster.sh --k3s
```

#### Option B: Local Kind Cluster (Development & Testing)

Spins up a local cluster inside Docker with host port mappings (`80`/`443`) and local volume persistence under `.sts-kind-data`:

```bash
./deploy/init-cluster.sh --kind
```

> [!TIP]
> Running `init-cluster.sh` without arguments launches an interactive prompt allowing you to pick between K3s and Kind.

---

### 3. Deploy & Run the Application Stack

Once the cluster is running, run `deploy.sh` to configure cluster secrets, deploy Argo CD, set up Argo CD Image Updater, and trigger GitOps synchronization:

#### Deploy to K3s / Existing Cluster

```bash
./deploy/deploy.sh --wait
```

#### Deploy to Local Kind Cluster

```bash
./deploy/deploy.sh --wait --kind
```

#### What `deploy.sh` Automates:
1. **Secret Provisioning**: Creates the `sts-prod` namespace and generates/synchronizes the `sts-secrets` Secret from `.env`.
2. **Ingress & Storage Setup**: Validates the `traefik` IngressClass and `local-path` StorageClass.
3. **Argo CD Deployment**: Installs Argo CD and applies `argocd/application.yaml` to track and sync manifests from git.
4. **Automated Image Updates**: Deploys Argo CD Image Updater (`argocd/image-updater.yaml`) to continuously poll GHCR and auto-deploy new container releases.
5. **Monitoring (Optional)**: Automatically installs `kube-prometheus-stack` with Prometheus and Grafana (can be disabled with `--no-monitoring`).

---

### 4. Verify Workloads & Access Endpoints

#### Check Workload Status

```bash
# Inspect all running pods, services, and ingresses in sts-prod
kubectl -n sts-prod get pods,svc,ingress,pvc

# Check Argo CD synchronization status
kubectl -n argocd get applications
```

#### Accessing Services

| Service / Interface | URL / Access Method | Credentials |
| :--- | :--- | :--- |
| **Support Desk Web App** | [http://localhost/](http://localhost/) (or node IP) | Email: `admin@example.com`<br>Password: configured in `.env` |
| **Backend REST API** | [http://localhost/api/v1](http://localhost/api/v1) | — |
| **Argo CD Dashboard** | Port-forward:<br>`kubectl -n argocd port-forward svc/argocd-server 8080:443`<br>Then open [https://localhost:8080](https://localhost:8080) | Username: `admin`<br>Password: `kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" \| base64 -d` |
| **Grafana Dashboard** | Port-forward:<br>`kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3001:80`<br>Then open [http://localhost:3001](http://localhost:3001) | Username: `admin`<br>Password: `prom-operator` |

---

### 5. Stop & Delete the Kubernetes Cluster

#### For Production K3s:

**To temporarily stop all pods and cluster processes:**
```bash
sudo systemctl stop k3s
sudo /usr/local/bin/k3s-killall.sh
```

**To restart K3s after stopping:**
```bash
sudo systemctl start k3s
```

**To completely delete and uninstall K3s (removes cluster, containers, and data):**
```bash
sudo systemctl stop k3s
sudo /usr/local/bin/k3s-uninstall.sh
```

#### For Local Kind:

**To delete the Kind cluster:**
```bash
kind delete cluster --name sts-prod
```

**To clean up local persistent storage data:**
```bash
rm -rf .sts-kind-data
```

#### To Delete Only Application Workloads (keep the cluster intact):
```bash
kubectl delete -f argocd/application.yaml
kubectl delete namespace sts-prod
```
