# Kubernetes Deployment

Initial Kubernetes deployment work for the Support Ticketing System.

## Application components

- Frontend: built from `frontend/Dockerfile`
- Backend: built from `backend/Dockerfile`
- Database: PostgreSQL 17
- Routing: currently configured through Traefik in `docker-compose.yml`

## Work remaining

- Add Kubernetes Deployments and Services for the frontend and backend.
- Configure PostgreSQL with a PersistentVolumeClaim and internal Service.
- Store JWT and database credentials using Kubernetes Secrets.
- Configure Kubernetes-compatible routing.
- Build and make the application images available to the cluster.
- Validate the manifests against a running Kubernetes cluster.

The Kubernetes deployment is not yet implemented or tested.
