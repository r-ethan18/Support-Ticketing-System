# Kubernetes Deployment

Initial Kubernetes deployment work for the Support Ticketing System.

## Application components

- Frontend: built from `frontend/Dockerfile`
- Backend: built from `backend/Dockerfile`
- Database: PostgreSQL 17
- Routing: currently configured through Traefik in `docker-compose.yml`

## Monitoring

The backend serves Prometheus metrics on a dedicated port (`METRICS_PORT`,
default `9100`, `0` disables) separate from the API port, so the ingress never
routes to them. `monitoring/` holds a `PodMonitor` for kube-prometheus-stack and
a `NetworkPolicy` that only lets Prometheus reach that port. The backend
Deployment must label its pods `app.kubernetes.io/name: sts-backend` and name
the container port `metrics`. Metrics are held in process memory and scraped;
nothing is written to Postgres.

## Work remaining

- Add Kubernetes Deployments and Services for the frontend and backend.
- Configure PostgreSQL with a PersistentVolumeClaim and internal Service.
- Store JWT and database credentials using Kubernetes Secrets.
- Configure Kubernetes-compatible routing.
- Build and make the application images available to the cluster.
- Validate the manifests against a running Kubernetes cluster.

The Kubernetes deployment is not yet implemented or tested.
