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

---

## Approach 1 — Bootstrap (kubectl, no external dependencies)

Use this for local development, staging, or the initial production bootstrap
before an ESO integration is in place.

```bash
# Generate strong random values for JWT_SECRET and DB_PASSWORD
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -hex 20)

kubectl create secret generic sts-secrets \
  --namespace=sts-prod \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=DB_NAME=sts \
  --from-literal=DB_USER=sts \
  --from-literal=DB_PASSWORD="${DB_PASSWORD}"
```

> **Never commit real values.** The commands above generate secrets at runtime
> and pass them directly to kubectl without writing them to disk.

To verify (keys only, not values):
```bash
kubectl get secret sts-secrets -n sts-prod -o jsonpath='{.data}' | python3 -c \
  "import sys, json; [print(k) for k in json.load(sys.stdin)]"
```

---

## Approach 2 — External Secrets Operator (production recommended)

External Secrets Operator (ESO) syncs secrets from an external store (e.g.
AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, Azure Key Vault)
into Kubernetes Secrets automatically.

### Prerequisites

1. **Install ESO** into the cluster:
   ```bash
   helm repo add external-secrets https://charts.external-secrets.io
   helm repo update
   helm install external-secrets external-secrets/external-secrets \
     --namespace external-secrets \
     --create-namespace
   ```

2. **Configure provider credentials** — this is provider-specific. ESO uses an
   IAM role, Workload Identity, or a static key to authenticate to the external
   store. See the [ESO provider docs](https://external-secrets.io/latest/provider/).

3. **Store the secret** in your external provider. Example key path:
   `sts-prod/sts-secrets` containing keys `JWT_SECRET`, `DB_NAME`, `DB_USER`,
   `DB_PASSWORD`.

### ClusterSecretStore template (AWS Secrets Manager example)

> **IMPORTANT** — replace every `<PLACEHOLDER>` before applying.

```yaml
# argocd/eso-cluster-secret-store.yaml
# DO NOT COMMIT with real values.
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: sts-aws-store
spec:
  provider:
    aws:
      service: SecretsManager
      region: <AWS_REGION>              # e.g. us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
```

### ExternalSecret template

> **IMPORTANT** — replace every `<PLACEHOLDER>` before applying.

```yaml
# k8s/overlays/production/external-secret.yaml
# DO NOT COMMIT with real values.
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: sts-secrets
  namespace: sts-prod
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: sts-aws-store           # name of the ClusterSecretStore above
    kind: ClusterSecretStore
  target:
    name: sts-secrets             # name of the resulting Kubernetes Secret
    creationPolicy: Owner
  data:
    - secretKey: JWT_SECRET
      remoteRef:
        key: <EXTERNAL_SECRET_PATH>   # e.g. sts-prod/sts-secrets
        property: JWT_SECRET
    - secretKey: DB_NAME
      remoteRef:
        key: <EXTERNAL_SECRET_PATH>
        property: DB_NAME
    - secretKey: DB_USER
      remoteRef:
        key: <EXTERNAL_SECRET_PATH>
        property: DB_USER
    - secretKey: DB_PASSWORD
      remoteRef:
        key: <EXTERNAL_SECRET_PATH>
        property: DB_PASSWORD
```

> ESO is **not operational** in this repository. The templates above are
> documentation only. You must install ESO, configure a provider, and grant the
> required permissions before applying them.
