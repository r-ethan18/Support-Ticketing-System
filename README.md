# Support Ticketing System (STS)

A comprehensive full-stack Support Ticketing System featuring a Next.js frontend, FastAPI backend, PostgreSQL database, Garage (S3-compatible) object storage for ticket attachments, and Traefik reverse proxy.

---

## Architecture Overview

- **Frontend**: Next.js application served on port `3000` (routed via Traefik reverse proxy).
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
[TODO: Add guide for deploying the application on Kubernetes cluster]