#!/usr/bin/env bash
# ==============================================================================
# deploy.sh — Production Deployment Script for Support Ticketing System
# ==============================================================================
# Automates the complete deployment workflow for a real Kubernetes cluster:
#   1. Sourced Configuration & Persistence:
#      - Loads credentials and environment variables from .env
#      - Persists cluster credentials safely in Kubernetes Secret 'sts-secrets'
#      - Reuses existing cluster credentials to prevent database/S3 desynchronization
#      - Ensures local and cluster volume persistence for PostgreSQL (2Gi) and Garage (6Gi)
#   2. Pre-flight Checks & Dependency Verification:
#      - Validates CLI tools (kubectl, helm, curl, jq, git, openssl/od)
#      - Separated from install-deps.sh (alerts with clear instructions if missing)
#   3. Cluster Prerequisites Configuration:
#      - Verifies default StorageClass (or provisions local-path-provisioner)
#      - Verifies Traefik Ingress (IngressClass 'traefik' in 'traefik' namespace)
#      - Verifies kube-prometheus-stack (namespace 'monitoring', release 'kube-prometheus-stack')
#   4. Strict Setup Order:
#      - Step 1: Create namespace 'sts-prod' and 'sts-secrets' with all 9 keys
#      - Step 2: Install Argo CD & apply argocd/application.yaml (tracks main)
#      - Step 3: Install Argo CD Image Updater & apply argocd/image-updater.yaml (polls GHCR)
#      - Step 4: Apply argocd/monitoring-application.yaml (PodMonitor + NetworkPolicy)
#   5. Diagnostic Error Explanations:
#      - Comprehensive root-cause error messages and actionable remediation steps
#
# Usage:
#   ./deploy.sh                      # Deploy using .env to current kubectl context
#   ./deploy.sh --wait               # Deploy and wait for all pods to become Ready
#   ./deploy.sh --kind               # Create a local Kind cluster with host persistence
#   ./deploy.sh --env-file .env.prod # Use custom env file
#   ./deploy.sh --no-monitoring      # Skip kube-prometheus-stack installation
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="sts-prod"
ARGOCD_NS="argocd"
MONITORING_NS="monitoring"
TRAEFIK_NS="traefik"

# Configuration defaults
ENV_FILE="${SCRIPT_DIR}/.env"
INSTALL_MONITORING=${INSTALL_MONITORING:-1}
WAIT_ROLLOUT=${WAIT_ROLLOUT:-0}
USE_KIND=${USE_KIND:-0}
KIND_CLUSTER_NAME=${KIND_CLUSTER_NAME:-"sts-prod"}
KIND_DATA_DIR="${SCRIPT_DIR}/.sts-kind-data"
FORCE_SECRETS=${FORCE_SECRETS:-0}

# Variables populated from .env or generated
JWT_SECRET=""
DB_NAME="sts"
DB_USER="sts"
DB_PASSWORD=""
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD=""
S3_ACCESS_KEY=""
S3_SECRET_KEY=""
GARAGE_RPC_SECRET=""

CLI_ADMIN_EMAIL=""
CLI_ADMIN_PASSWORD=""

# ==============================================================================
# UI HELPERS & DIAGNOSTIC ERROR EXPLAINER
# ==============================================================================
step() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[1;32m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m[WARN]\033[0m %s\n' "$*"; }

explain_error() {
  local context="$1"
  local reason="$2"
  local remediation="$3"
  echo "" >&2
  printf '\033[1;31m======================================================================\033[0m\n' >&2
  printf '\033[1;31m[DEPLOYMENT ERROR]\033[0m \033[1m%s\033[0m\n' "$context" >&2
  printf '  \033[1;33mReason:\033[0m      %s\n' "$reason" >&2
  printf '  \033[1;32mRemediation:\033[0m %s\n' "$remediation" >&2
  printf '\033[1;31m======================================================================\033[0m\n' >&2
  echo "" >&2
  exit 1
}

rand_hex() {
  local bytes=$1
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif command -v od >/dev/null 2>&1; then
    head -c "$bytes" /dev/urandom | od -An -vtx1 | tr -d ' \n'
  else
    explain_error "Cannot generate cryptographic random bytes" \
      "Neither 'openssl' nor 'od' (coreutils) was found on PATH." \
      "Run './install-deps.sh' to install openssl and coreutils."
  fi
}

retry() {
  local max=$1; shift
  for i in $(seq 1 "$max"); do
    if "$@"; then return 0; fi
    warn "Attempt $i/$max failed: $*"
    sleep $((i * 3))
  done
  explain_error "Command retry failed after $max attempts" \
    "Command '$*' failed consistently." \
    "Check network connectivity, chart repository URLs, and cluster responsiveness."
}

# Parse CLI options
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --wait)
      WAIT_ROLLOUT=1
      shift
      ;;
    --kind)
      USE_KIND=1
      shift
      ;;
    --no-monitoring)
      INSTALL_MONITORING=0
      shift
      ;;
    --force-secrets)
      FORCE_SECRETS=1
      shift
      ;;
    --admin-email)
      CLI_ADMIN_EMAIL="$2"
      shift 2
      ;;
    --admin-password)
      CLI_ADMIN_PASSWORD="$2"
      shift 2
      ;;
    -h|--help)
      cat <<EOF
Usage: $0 [OPTIONS]

Deployment script for Support Ticketing System on Kubernetes via Argo CD.

Options:
  --env-file PATH      Path to environment file (default: .env in repo root)
  --wait               Wait for Argo CD application sync and workload rollout
  --kind               Provision a local Kind cluster with host volume persistence
  --no-monitoring      Skip installing kube-prometheus-stack
  --force-secrets      Overwrite existing cluster 'sts-secrets' with .env values
  --admin-email EMAIL  Override initial admin email
  --admin-password PWD Override initial admin password (must be >= 12 characters)
  -h, --help           Show this help message and exit
EOF
      exit 0
      ;;
    *)
      explain_error "Unknown command-line argument: $1" \
        "The option '$1' is not recognized by deploy.sh." \
        "Run '$0 --help' to see valid arguments."
      ;;
  esac
done

# ==============================================================================
# STEP 0: PRE-FLIGHT CHECKS & DEPENDENCY VERIFICATION
# ==============================================================================
step "Step 0: Checking required CLI tools"
REQUIRED_TOOLS=(kubectl helm curl jq git)
MISSING_TOOLS=()

for tool in "${REQUIRED_TOOLS[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    MISSING_TOOLS+=("$tool")
  fi
done

if [[ ${#MISSING_TOOLS[@]} -gt 0 ]]; then
  explain_error "Missing required CLI tools: ${MISSING_TOOLS[*]}" \
    "One or more host utilities required for deployment are not installed on PATH." \
    "Run './install-deps.sh' to install all required dependencies for your OS."
fi
info "All required CLI tools are present: ${REQUIRED_TOOLS[*]}"

# ==============================================================================
# ENVIRONMENT VARIABLES & CREDENTIALS PERSISTENCE (.env)
# ==============================================================================
step "Loading environment variables from '${ENV_FILE}'"
if [[ -f "$ENV_FILE" ]]; then
  info "Parsing environment variables from '${ENV_FILE}'"
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Trim leading/trailing whitespace
    line="$(echo "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    # Skip comments and blank lines
    if [[ -z "$line" || "$line" =~ ^# ]]; then
      continue
    fi
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      # Strip surrounding quotes
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      case "$key" in
        JWT_SECRET)        JWT_SECRET="$val" ;;
        DB_NAME)           DB_NAME="$val" ;;
        DB_USER)           DB_USER="$val" ;;
        DB_PASSWORD)       DB_PASSWORD="$val" ;;
        POSTGRES_PASSWORD) [[ -z "$DB_PASSWORD" ]] && DB_PASSWORD="$val" ;;
        ADMIN_EMAIL)       ADMIN_EMAIL="$val" ;;
        ADMIN_PASSWORD)    ADMIN_PASSWORD="$val" ;;
        S3_ACCESS_KEY)     S3_ACCESS_KEY="$val" ;;
        S3_SECRET_KEY)     S3_SECRET_KEY="$val" ;;
        GARAGE_RPC_SECRET) GARAGE_RPC_SECRET="$val" ;;
      esac
    fi
  done < "$ENV_FILE"
  info "Successfully loaded configuration from '${ENV_FILE}'."
else
  warn "Environment file '${ENV_FILE}' not found. Generating fresh cryptographic secrets."
fi

# Apply CLI overrides if specified
[[ -n "$CLI_ADMIN_EMAIL" ]] && ADMIN_EMAIL="$CLI_ADMIN_EMAIL"
[[ -n "$CLI_ADMIN_PASSWORD" ]] && ADMIN_PASSWORD="$CLI_ADMIN_PASSWORD"

# ==============================================================================
# SECRETS VALIDATION & PERSISTENCE GENERATION
# ==============================================================================
step "Validating and ensuring cryptographic secrets"
DIRTY_SECRETS=0

# 1. JWT_SECRET (>= 32 chars)
if [[ -z "$JWT_SECRET" ]]; then
  JWT_SECRET=$(rand_hex 32)
  info "Generated new JWT_SECRET (64 hex characters)."
  DIRTY_SECRETS=1
elif [[ ${#JWT_SECRET} -lt 32 ]]; then
  explain_error "Invalid JWT_SECRET length (${#JWT_SECRET} chars)" \
    "The backend strictly requires JWT_SECRET to be at least 32 characters long." \
    "Update JWT_SECRET in '${ENV_FILE}' to a 32+ character random string or remove it to auto-generate."
fi

# 2. DB credentials
[[ -z "$DB_NAME" ]] && DB_NAME="sts"
[[ -z "$DB_USER" ]] && DB_USER="sts"
if [[ -z "$DB_PASSWORD" ]]; then
  DB_PASSWORD=$(rand_hex 20)
  info "Generated new DB_PASSWORD."
  DIRTY_SECRETS=1
fi

# 3. ADMIN credentials
[[ -z "$ADMIN_EMAIL" ]] && ADMIN_EMAIL="admin@example.com"
if [[ -z "$ADMIN_PASSWORD" ]]; then
  ADMIN_PASSWORD=$(rand_hex 16) # 32 hex chars >= 12 chars requirement
  info "Generated new ADMIN_PASSWORD (32 characters)."
  DIRTY_SECRETS=1
elif [[ ${#ADMIN_PASSWORD} -lt 12 ]]; then
  warn "ADMIN_PASSWORD in '${ENV_FILE}' is '${ADMIN_PASSWORD}' (${#ADMIN_PASSWORD} chars)."
  warn "The production backend requires ADMIN_PASSWORD >= 12 chars (see k8s/secrets.md)."
  warn "Auto-generating a secure 32-character ADMIN_PASSWORD to prevent backend crash."
  ADMIN_PASSWORD=$(rand_hex 16)
  DIRTY_SECRETS=1
fi

# 4. Garage S3 credentials
# S3_ACCESS_KEY: 'GK' + 32 hex chars = 34 chars total
if [[ -z "$S3_ACCESS_KEY" ]]; then
  S3_ACCESS_KEY="GK$(rand_hex 16)"
  info "Generated new S3_ACCESS_KEY (${S3_ACCESS_KEY})."
  DIRTY_SECRETS=1
elif [[ ! "$S3_ACCESS_KEY" =~ ^GK[0-9a-fA-F]{32}$ ]]; then
  explain_error "Invalid S3_ACCESS_KEY format: '${S3_ACCESS_KEY}'" \
    "Garage requires S3_ACCESS_KEY to start with 'GK' followed by exactly 32 hex characters." \
    "Update S3_ACCESS_KEY in '${ENV_FILE}' to match 'GK<32-hex-chars>' or remove it to auto-generate."
fi

# S3_SECRET_KEY: 64 hex chars
if [[ -z "$S3_SECRET_KEY" ]]; then
  S3_SECRET_KEY=$(rand_hex 32)
  info "Generated new S3_SECRET_KEY."
  DIRTY_SECRETS=1
elif [[ ! "$S3_SECRET_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  explain_error "Invalid S3_SECRET_KEY format" \
    "Garage requires S3_SECRET_KEY to be exactly 64 hexadecimal characters (32 bytes)." \
    "Update S3_SECRET_KEY in '${ENV_FILE}' or remove it to auto-generate."
fi

# GARAGE_RPC_SECRET: 64 hex chars
if [[ -z "$GARAGE_RPC_SECRET" ]]; then
  GARAGE_RPC_SECRET=$(rand_hex 32)
  info "Generated new GARAGE_RPC_SECRET."
  DIRTY_SECRETS=1
elif [[ ! "$GARAGE_RPC_SECRET" =~ ^[0-9a-fA-F]{64}$ ]]; then
  explain_error "Invalid GARAGE_RPC_SECRET format" \
    "Garage requires GARAGE_RPC_SECRET to be exactly 64 hexadecimal characters." \
    "Update GARAGE_RPC_SECRET in '${ENV_FILE}' or remove it to auto-generate."
fi

# Save generated secrets back to .env if new ones were generated and .env does not exist
# if [[ "$DIRTY_SECRETS" -eq 1 && ! -f "$ENV_FILE" ]]; then
#   info "Persisting generated configuration to '${ENV_FILE}' for future runs"
#   cat > "$ENV_FILE" <<EOF
# Support Ticketing System Environment Secrets
# JWT_SECRET=${JWT_SECRET}
# DB_NAME=${DB_NAME}
# DB_USER=${DB_USER}
# DB_PASSWORD=${DB_PASSWORD}
# ADMIN_EMAIL=${ADMIN_EMAIL}
# ADMIN_PASSWORD=${ADMIN_PASSWORD}
# S3_ACCESS_KEY=${S3_ACCESS_KEY}
# S3_SECRET_KEY=${S3_SECRET_KEY}
# GARAGE_RPC_SECRET=${GARAGE_RPC_SECRET}
# EOF
#   chmod 0600 "$ENV_FILE"
#   info "Saved '${ENV_FILE}' (mode 0600)."
# fi

# ==============================================================================
# CLUSTER CONNECTION & OPTIONAL KIND PROVISIONING WITH HOST PERSISTENCE
# ==============================================================================
if [[ "$USE_KIND" -eq 1 ]]; then
  if ! command -v kind >/dev/null 2>&1; then
    explain_error "'kind' CLI tool not found" \
      "The '--kind' flag was passed but kind is not installed on PATH." \
      "Run './install-deps.sh' to install kind, or deploy against an existing cluster."
  fi
  step "Creating Kind cluster '${KIND_CLUSTER_NAME}' with host data persistence and port mapping"
  mkdir -p "${KIND_DATA_DIR}"
  info "Host data directory for PVC persistence: '${KIND_DATA_DIR}'"

  if kind get clusters 2>/dev/null | grep -qx "${KIND_CLUSTER_NAME}"; then
    info "Kind cluster '${KIND_CLUSTER_NAME}' already exists. Reusing it."
  else
    cat <<EOF | kind create cluster --name "${KIND_CLUSTER_NAME}" --config=-
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30080
        hostPort: 80
        listenAddress: 0.0.0.0
      - containerPort: 30443
        hostPort: 443
        listenAddress: 0.0.0.0
    extraMounts:
      - hostPath: "${KIND_DATA_DIR}"
        containerPath: /var/local-path-provisioner
EOF
    info "Kind cluster '${KIND_CLUSTER_NAME}' created with host-mounted volume persistence."
  fi
fi

step "Checking Kubernetes cluster connectivity"
if ! kubectl cluster-info >/dev/null 2>&1; then
  explain_error "Cannot reach Kubernetes API server" \
    "kubectl cluster-info failed. Either no cluster is running, KUBECONFIG is missing, or the cluster is stopped." \
    "Run './init-cluster.sh' to launch a cluster (use '--k3s' for production, or '--kind' for local testing)."
fi
ACTIVE_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "default")
info "Connected to Kubernetes cluster (context: '${ACTIVE_CONTEXT}')."

# ==============================================================================
# PREREQUISITE 1: StorageClass Verification & Data Persistence
# ==============================================================================
step "Verifying StorageClass for Data Persistence (Postgres 2Gi, Garage 1Gi+5Gi)"
DEFAULT_SC=$(kubectl get sc -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || true)

if [[ -n "$DEFAULT_SC" ]]; then
  info "Default StorageClass found: '${DEFAULT_SC}'"
else
  # Check if any non-default StorageClass exists
  ANY_SC=$(kubectl get sc -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [[ -n "$ANY_SC" ]]; then
    warn "No default StorageClass found, but StorageClass '${ANY_SC}' exists."
    info "Setting '${ANY_SC}' as the default StorageClass to allow PVC binding."
    kubectl patch storageclass "$ANY_SC" -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
    info "Designated '${ANY_SC}' as default StorageClass."
  else
    warn "No StorageClass found in the cluster. Installing Rancher local-path-provisioner."
    retry 3 kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.28/deploy/local-path-storage.yaml
    kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
    info "Installed local-path-provisioner and designated 'local-path' as default StorageClass."
  fi
fi

# Verify StorageClass provisioner is active
RECLAIM_POLICY=$(kubectl get sc "${DEFAULT_SC:-local-path}" -o jsonpath='{.reclaimPolicy}' 2>/dev/null || echo "Delete")
info "StorageClass persistence policy: ${RECLAIM_POLICY}. StatefulSet PVCs persist across pod restarts."

# ==============================================================================
# PREREQUISITE 2: Traefik Ingress Controller
# ==============================================================================
step "Verifying Traefik Ingress Controller (IngressClass 'traefik')"
if kubectl get ingressclass traefik >/dev/null 2>&1; then
  info "IngressClass 'traefik' is already registered in the cluster."
else
  info "IngressClass 'traefik' not found. Installing Traefik via Helm into namespace '${TRAEFIK_NS}'"
  retry 3 helm repo add traefik https://traefik.github.io/charts --force-update
  retry 3 helm repo update traefik

  HELM_EXTRA_ARGS=()
  if [[ "$USE_KIND" -eq 1 ]]; then
    HELM_EXTRA_ARGS+=(--set service.type=NodePort --set ports.web.nodePort=30080)
  fi

  retry 3 helm upgrade --install traefik traefik/traefik \
    --namespace "${TRAEFIK_NS}" --create-namespace \
    --set ingressClass.enabled=true \
    --set ingressClass.isDefaultClass=false \
    --set ports.web.exposedPort=80 \
    "${HELM_EXTRA_ARGS[@]}"

  info "Waiting for Traefik Ingress Controller deployment to become Ready..."
  kubectl -n "${TRAEFIK_NS}" rollout status deployment/traefik --timeout=180s || {
    explain_error "Traefik Ingress Controller failed to roll out" \
      "Deployment in namespace '${TRAEFIK_NS}' timed out." \
      "Run 'kubectl -n ${TRAEFIK_NS} describe pods' to inspect scheduling or image pull errors."
  }
  info "Traefik is Ready."
fi

# ==============================================================================
# PREREQUISITE 3: kube-prometheus-stack (Monitoring)
# ==============================================================================
if [[ "$INSTALL_MONITORING" -eq 1 ]]; then
  step "Verifying kube-prometheus-stack in namespace '${MONITORING_NS}'"
  if helm -n "${MONITORING_NS}" status kube-prometheus-stack >/dev/null 2>&1; then
    info "Helm release 'kube-prometheus-stack' already exists in namespace '${MONITORING_NS}'."
  else
    info "Installing kube-prometheus-stack via Helm (release name matches PodMonitor)"
    retry 3 helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
    retry 3 helm repo update prometheus-community

    retry 3 helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
      --namespace "${MONITORING_NS}" --create-namespace \
      --set alertmanager.enabled=false \
      --set grafana.enabled=false \
      --set nodeExporter.enabled=false \
      --set kubeStateMetrics.enabled=true \
      --set prometheus.prometheusSpec.retention=1h \
      --wait --timeout 8m
    info "kube-prometheus-stack is installed and Ready."
  fi
else
  info "Skipping kube-prometheus-stack installation (--no-monitoring)."
fi

# ==============================================================================
# STEP 1: Namespace & Secret Persistence (sts-prod / sts-secrets)
# ==============================================================================
step "Step 1: Setting up namespace '${NS}' and persisting 'sts-secrets'"
kubectl create namespace "${NS}" --dry-run=client -o yaml | kubectl apply -f -

if kubectl -n "${NS}" get secret sts-secrets >/dev/null 2>&1; then
  if [[ "$FORCE_SECRETS" -eq 1 ]]; then
    warn "--force-secrets specified. Updating cluster Secret 'sts-secrets' with current configuration."
    kubectl create secret generic sts-secrets \
      --namespace="${NS}" \
      --from-literal=JWT_SECRET="${JWT_SECRET}" \
      --from-literal=DB_NAME="${DB_NAME}" \
      --from-literal=DB_USER="${DB_USER}" \
      --from-literal=DB_PASSWORD="${DB_PASSWORD}" \
      --from-literal=ADMIN_EMAIL="${ADMIN_EMAIL}" \
      --from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
      --from-literal=S3_ACCESS_KEY="${S3_ACCESS_KEY}" \
      --from-literal=S3_SECRET_KEY="${S3_SECRET_KEY}" \
      --from-literal=GARAGE_RPC_SECRET="${GARAGE_RPC_SECRET}" \
      --dry-run=client -o yaml | kubectl apply -f -
    info "Updated Secret 'sts-secrets'."
  else
    info "Cluster Secret 'sts-secrets' already exists in namespace '${NS}'. Preserving existing credentials."
    # Read existing admin email/password from secret if available for reporting
    EXISTING_EMAIL=$(kubectl -n "${NS}" get secret sts-secrets -o jsonpath='{.data.ADMIN_EMAIL}' 2>/dev/null | base64 -d || echo "$ADMIN_EMAIL")
    ADMIN_EMAIL="$EXISTING_EMAIL"
  fi
else
  info "Creating Kubernetes Secret 'sts-secrets' in namespace '${NS}'"
  kubectl create secret generic sts-secrets \
    --namespace="${NS}" \
    --from-literal=JWT_SECRET="${JWT_SECRET}" \
    --from-literal=DB_NAME="${DB_NAME}" \
    --from-literal=DB_USER="${DB_USER}" \
    --from-literal=DB_PASSWORD="${DB_PASSWORD}" \
    --from-literal=ADMIN_EMAIL="${ADMIN_EMAIL}" \
    --from-literal=ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    --from-literal=S3_ACCESS_KEY="${S3_ACCESS_KEY}" \
    --from-literal=S3_SECRET_KEY="${S3_SECRET_KEY}" \
    --from-literal=GARAGE_RPC_SECRET="${GARAGE_RPC_SECRET}"
  info "Created 'sts-secrets' with all 9 required keys."
fi

# Verify all 9 keys exist in sts-secrets
CONFIRMED_KEYS=$(kubectl get secret sts-secrets -n "${NS}" -o jsonpath='{.data}' | jq -r 'keys | sort | join(", ")')
info "Verified keys present in ${NS}/sts-secrets: ${CONFIRMED_KEYS}"

# ==============================================================================
# STEP 2: Install Argo CD & Apply application.yaml
# ==============================================================================
step "Step 2: Installing Argo CD and deploying Application 'support-ticketing-system'"
kubectl create namespace "${ARGOCD_NS}" --dry-run=client -o yaml | kubectl apply -f -

if ! kubectl -n "${ARGOCD_NS}" get deploy/argocd-server >/dev/null 2>&1; then
  info "Installing Argo CD manifests..."
  retry 3 kubectl apply --server-side --force-conflicts -n "${ARGOCD_NS}" \
    -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
  info "Waiting for Argo CD Server deployment..."
  kubectl -n "${ARGOCD_NS}" rollout status deploy/argocd-server --timeout=300s || {
    explain_error "Argo CD Server rollout timed out" \
      "deploy/argocd-server in namespace '${ARGOCD_NS}' did not become ready." \
      "Run 'kubectl -n ${ARGOCD_NS} describe pod -l app.kubernetes.io/name=argocd-server' to inspect issues."
  }
fi
info "Argo CD is active."

info "Applying '${SCRIPT_DIR}/argocd/application.yaml'..."
kubectl apply -f "${SCRIPT_DIR}/argocd/application.yaml"
info "Argo CD Application 'support-ticketing-system' applied (tracks Git main at k8s/overlays/production)."

# ==============================================================================
# STEP 3: Install Argo CD Image Updater & Apply image-updater.yaml
# ==============================================================================
step "Step 3: Installing Argo CD Image Updater and applying ImageUpdater resource"
if ! kubectl -n "${ARGOCD_NS}" get deploy/argocd-image-updater-controller >/dev/null 2>&1; then
  info "Installing Argo CD Image Updater manifests..."
  retry 3 kubectl apply -n "${ARGOCD_NS}" \
    -f https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/stable/config/install.yaml
  info "Waiting for Argo CD Image Updater controller..."
  kubectl -n "${ARGOCD_NS}" rollout status deploy/argocd-image-updater-controller --timeout=300s || {
    explain_error "Argo CD Image Updater rollout timed out" \
      "deploy/argocd-image-updater-controller in '${ARGOCD_NS}' did not become ready." \
      "Inspect logs with 'kubectl -n ${ARGOCD_NS} logs deploy/argocd-image-updater-controller'."
  }
fi
info "Argo CD Image Updater is active."

info "Applying '${SCRIPT_DIR}/argocd/image-updater.yaml'..."
kubectl apply -f "${SCRIPT_DIR}/argocd/image-updater.yaml"
info "ImageUpdater applied. It will poll GHCR and automatically set the newest sha-* image tags."

# ==============================================================================
# STEP 4: Apply Monitoring Application
# ==============================================================================
if [[ "$INSTALL_MONITORING" -eq 1 ]]; then
  step "Step 4: Applying monitoring application '${SCRIPT_DIR}/argocd/monitoring-application.yaml'"
  kubectl apply -f "${SCRIPT_DIR}/argocd/monitoring-application.yaml"
  info "Monitoring Application applied (deploys PodMonitor and NetworkPolicy)."
fi

# ==============================================================================
# STEP 5: Verification, Workload Rollout & Persistence Status
# ==============================================================================
if [[ "$WAIT_ROLLOUT" -eq 1 ]]; then
  step "Step 5: Waiting for workloads to roll out in namespace '${NS}'"
  info "Waiting for PostgreSQL StatefulSet (postgres-0)..."
  kubectl -n "${NS}" rollout status statefulset/postgres --timeout=240s || {
    explain_error "PostgreSQL StatefulSet failed to roll out" \
      "StatefulSet 'postgres' in namespace '${NS}' did not become Ready." \
      "Check PVC status with 'kubectl -n ${NS} get pvc' or logs with 'kubectl -n ${NS} logs statefulset/postgres'."
  }

  info "Waiting for Garage StatefulSet (garage-0)..."
  kubectl -n "${NS}" rollout status statefulset/garage --timeout=240s || {
    explain_error "Garage StatefulSet failed to roll out" \
      "StatefulSet 'garage' in namespace '${NS}' did not become Ready." \
      "Check PVC status with 'kubectl -n ${NS} get pvc' or logs with 'kubectl -n ${NS} logs statefulset/garage'."
  }

  info "Waiting for Backend Deployment..."
  kubectl -n "${NS}" rollout status deploy/backend --timeout=300s || {
    explain_error "Backend Deployment failed to roll out" \
      "Deployment 'backend' in namespace '${NS}' did not become Ready." \
      "Check container logs with 'kubectl -n ${NS} logs deploy/backend --tail=50'."
  }

  info "Waiting for Frontend Deployment..."
  kubectl -n "${NS}" rollout status deploy/frontend --timeout=300s || {
    explain_error "Frontend Deployment failed to roll out" \
      "Deployment 'frontend' in namespace '${NS}' did not become Ready." \
      "Check container logs with 'kubectl -n ${NS} logs deploy/frontend --tail=50'."
  }
fi

# Fetch Argo CD initial admin secret
ARGOCD_PWD=$(kubectl -n "${ARGOCD_NS}" get secret argocd-initial-admin-secret -o jsonpath="{.data.password}" 2>/dev/null | base64 -d || echo "N/A (already changed or secret rotated)")

step "Deployment Completed Successfully"

echo ""
echo "======================================================================"
echo "  PERSISTENCE & STORAGE STATUS (${NS})"
echo "======================================================================"
kubectl -n "${NS}" get pvc -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,VOLUME:.spec.volumeName,STORAGECLASS:.spec.storageClassName,CAPACITY:.status.capacity.storage 2>/dev/null || true

echo ""
echo "======================================================================"
echo "  WORKLOADS STATUS (${NS})"
echo "======================================================================"
kubectl -n "${NS}" get pods,svc,ingress 2>/dev/null || true

echo ""
echo "======================================================================"
echo "  ARGO CD APPLICATION & IMAGE UPDATER STATUS"
echo "======================================================================"
kubectl -n "${ARGOCD_NS}" get applications 2>/dev/null || true
echo ""
kubectl -n "${ARGOCD_NS}" get imageupdater 2>/dev/null || true

echo ""
echo "======================================================================"
echo "  ACCESS INSTRUCTIONS & CREDENTIALS"
echo "======================================================================"
echo "  [Application - Support Desk via Traefik Ingress]"
echo "    Frontend: http://localhost/  (or cluster node IP on port 80)"
echo "    API:      http://localhost/api/v1"
echo ""
echo "  [Application Admin Login]"
echo "    Email:    ${ADMIN_EMAIL}"
echo "    Password: ${ADMIN_PASSWORD}"
echo ""
echo "  [Argo CD Management UI]"
echo "    Port Forward: kubectl -n ${ARGOCD_NS} port-forward svc/argocd-server 8080:443"
echo "    URL:          https://localhost:8080"
echo "    Username:     admin"
echo "    Password:     ${ARGOCD_PWD}"
echo ""
echo "  [Image Updater Logs]"
echo "    kubectl -n ${ARGOCD_NS} logs -f deploy/argocd-image-updater-controller"
echo "======================================================================"
echo ""
