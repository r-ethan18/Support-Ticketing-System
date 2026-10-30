# Secrets Setup for Support Ticketing System

All workloads consume credentials through a single Kubernetes Secret named
`sts-secrets` in the `sts-prod` namespace.

---

## Required Secret Keys

| Key | Description | Notes |
|-----|-------------|-------|
| `JWT_SECRET` | JWT signing secret | **Must be ≥ 32 characters** |
| `DB_NAME` | PostgreSQL database name | e.g. `sts` |
| `DB_USER` | PostgreSQL user | e.g. `sts` |
| `DB_PASSWORD` | PostgreSQL password | Use a strong random value |
| `ADMIN_EMAIL` | Email of the first admin | **Required**; created on first start |
| `ADMIN_PASSWORD` | Password of the first admin | **Required**, at least 12 characters |

---

## Creating the Secret

Generate strong random values and create the Secret in one step.
Credentials are passed directly to `kubectl` from shell variables — they are
never written to disk or committed to the repository.

```bash
# Generate strong random values
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 20)
ADMIN_EMAIL=admin@example.com            # change to the real admin address
ADMIN_PASSWORD=$(openssl rand -hex 16)   # note it down: it is not shown again

# Ensure the namespace exists
kubectl create namespace sts-prod --dry-run=client -o yaml | kubectl apply -f -

# Create the Secret
kubectl create secret generic sts-secrets \
  --namespace=sts-prod \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=DB_NAME=sts \
  --from-literal=DB_USER=sts \
  --from-literal=DB_PASSWORD="${DB_PASSWORD}" \
  --from-literal=ADMIN_EMAIL="${ADMIN_EMAIL}" \
  --from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD}"
```

To verify (keys only, not values):
```bash
kubectl get secret sts-secrets -n sts-prod -o jsonpath='{.data}' \
  | python3 -c "import sys, json; [print(k) for k in json.load(sys.stdin)]"
```

> **Never commit real values.** Do not store generated secrets in files
> tracked by Git. The `kubectl create secret` command above passes values
> entirely through shell variables.

---

## Rotating the Secret

To update a credential (e.g. rotate `JWT_SECRET`):

```bash
JWT_SECRET=$(openssl rand -hex 32)

kubectl create secret generic sts-secrets \
  --namespace=sts-prod \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=DB_NAME=sts \
  --from-literal=DB_USER=sts \
  --from-literal=DB_PASSWORD="<existing-value>" \
  --from-literal=ADMIN_EMAIL="<existing-value>" \
  --from-literal=ADMIN_PASSWORD="<existing-value>" \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart the backend to pick up the new JWT_SECRET
kubectl rollout restart deployment/backend -n sts-prod
```
