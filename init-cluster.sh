#!/usr/bin/env bash
# ==============================================================================
# init-cluster.sh — Kubernetes Cluster Launcher for Support Ticketing System
# ==============================================================================
# Launches and configures a Kubernetes cluster ready for deploy.sh:
#
#   1. Production Mode (K3s - Recommended for Servers & VMs):
#      - Installs certified lightweight CNCF Kubernetes via systemd
#      - Auto-starts on server reboot
#      - Pre-installs default StorageClass ('local-path') for persistent PVCs
#      - Pre-installs Traefik (IngressClass 'traefik')
#      - Enforces NetworkPolicies natively via Flannel/Kube-router
#
#   2. Development Mode (Kind - For local testing & throwaway rehearsals):
#      - Uses kind (Kubernetes IN Docker) with extraPortMappings (80 / 443)
#      - Configures host volume persistence in ./.sts-kind-data
#
# Usage:
#   ./init-cluster.sh           # Interactive / auto-detects best launcher
#   ./init-cluster.sh --k3s     # Production K3s cluster managed by systemd
#   ./init-cluster.sh --kind    # Local Kind cluster for testing
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIND_CLUSTER_NAME="sts-prod"
KIND_DATA_DIR="${SCRIPT_DIR}/.sts-kind-data"
LAUNCHER=""

step() { printf '\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[1;32m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '  \033[1;33m[WARN]\033[0m %s\n' "$*"; }
fail() { printf '  \033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --k3s)
      LAUNCHER="k3s"
      shift
      ;;
    --kind)
      LAUNCHER="kind"
      shift
      ;;
    -h|--help)
      cat <<EOF
Usage: $0 [OPTIONS]

Options:
  --k3s    Launch production K3s cluster (systemd service, auto-reboot, local-path storage)
  --kind   Launch local Kind cluster in Docker (for local testing only)
  -h, --help Show this help message
EOF
      exit 0
      ;;
    *)
      fail "Unknown option: $1. Run with --help for usage."
      ;;
  esac
done

# If launcher not explicitly specified, ask or detect
if [[ -z "$LAUNCHER" ]]; then
  echo "======================================================================"
  echo "  Select Kubernetes Cluster Launcher:"
  echo "  1) K3s  [PRODUCTION RECOMMENDED] - Native Linux cluster via systemd"
  echo "  2) Kind [TESTING / DEV ONLY]     - Runs in Docker containers"
  echo "======================================================================"
  read -r -p "Enter choice [1/2] (default: 1): " CHOICE || CHOICE="1"
  case "${CHOICE:-1}" in
    1|k3s)  LAUNCHER="k3s" ;;
    2|kind) LAUNCHER="kind" ;;
    *)      LAUNCHER="k3s" ;;
  esac
fi

# ==============================================================================
# LAUNCHER: K3s (PRODUCTION)
# ==============================================================================
launch_k3s() {
  step "Starting Production K3s Kubernetes Cluster"

  if ! command -v k3s >/dev/null 2>&1; then
    fail "K3s is not installed on this system. Please run './install-deps.sh' first to install K3s and system dependencies."
  fi

  if systemctl is-active --quiet k3s 2>/dev/null; then
    info "K3s service is already running."
  else
    info "Starting K3s systemd service..."
    sudo systemctl enable --now k3s
    sleep 3
  fi

  # Set up ~/.kube/config for non-root kubectl access
  mkdir -p "$HOME/.kube"
  if [[ -f /etc/rancher/k3s/k3s.yaml ]]; then
    sudo cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
    sudo chown "$(id -u):$(id -g)" "$HOME/.kube/config"
    chmod 600 "$HOME/.kube/config"
    info "Configured $HOME/.kube/config from K3s."
  fi

  info "Waiting for Kubernetes node to reach Ready state..."
  kubectl wait --for=condition=Ready node --all --timeout=60s

  info "Verifying built-in StorageClass and IngressClass..."
  kubectl get sc local-path 2>/dev/null || true
  kubectl get ingressclass traefik 2>/dev/null || true

  step "K3s Production Cluster is Ready!"
  echo "  - StorageClass: 'local-path' (default, persistent on host disk)"
  echo "  - Ingress:      Traefik (listening on host ports 80/443)"
}

# ==============================================================================
# LAUNCHER: Kind (DEV / TESTING)
# ==============================================================================
launch_kind() {
  step "Launching Local Kind Cluster '${KIND_CLUSTER_NAME}' (DEV ONLY)"

  if ! command -v kind >/dev/null 2>&1; then
    fail "Kind is not installed. Run './install-deps.sh' to install it."
  fi

  if ! command -v docker >/dev/null 2>&1; then
    fail "Docker is required to run Kind. Ensure docker is installed and running."
  fi

  mkdir -p "${KIND_DATA_DIR}"
  info "Configuring host volume directory for persistence: ${KIND_DATA_DIR}"

  if kind get clusters 2>/dev/null | grep -qx "${KIND_CLUSTER_NAME}"; then
    info "Kind cluster '${KIND_CLUSTER_NAME}' is already running."
  else
    info "Creating cluster with Traefik port mappings (host 80/443 -> container 30080/30443)..."
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
  fi

  kubectl cluster-info --context "kind-${KIND_CLUSTER_NAME}"
  info "Kind cluster '${KIND_CLUSTER_NAME}' is Ready."
}

# Execute chosen launcher
case "$LAUNCHER" in
  k3s)  launch_k3s ;;
  kind) launch_kind ;;
esac

echo ""
echo "======================================================================"
echo "  Cluster launched successfully! You can now deploy the application:"
echo ""
echo "    ./deploy.sh --wait"
echo "======================================================================"
echo ""
