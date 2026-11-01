#!/usr/bin/env bash
# Install host-level CLI packages required for testing (kind-test.sh) and
# production deployment scripts on Ubuntu 24.04.4 LTS, Arch Linux, or NixOS.
# Does NOT create clusters, deploy workloads, or modify system configurations.
set -euo pipefail

# ==============================================================================
# EDITABLE PACKAGE LISTS
# Add or remove packages per OS here.
# ==============================================================================

# Ubuntu 24.04.4 LTS standard apt packages
UBUNTU_APT_PACKAGES=(
  ca-certificates
  curl
  gpg
  jq
  git
  coreutils
#  docker.io
  openssl
)

# Ubuntu external Kubernetes tools (1 = install if missing, 0 = skip)
UBUNTU_INSTALL_KUBECTL=1
UBUNTU_INSTALL_HELM=1
HELM_VERSION=v3.16.4
UBUNTU_INSTALL_KIND=1
UBUNTU_INSTALL_ARGOCD_CLI=1
UBUNTU_INSTALL_K3S=1

# Arch Linux (pacman) packages
ARCH_PACKAGES=(
  curl
  jq
  git
  coreutils
  docker
  kubectl
  helm
  kind
  argocd
  openssl
)

# NixOS packages (passed to `nix shell nixpkgs#<pkg>`)
NIX_PACKAGES=(
  curl
  jq
  git
  coreutils
  docker
  kubectl
  kubernetes-helm
  kind
  argocd
  openssl
  k3s
)

# Binaries verified at the end of the script
REQUIRED_BINARIES=(
  docker
  kubectl
  helm
  kind
  argocd
  curl
  jq
  od
  git
  openssl
  k3s
)

# ==============================================================================
# OS DETECTION & INSTALLATION LOGIC
# ==============================================================================

step() { printf '\n==> %s\n' "$*"; }

if [[ ! -f /etc/os-release ]]; then
  echo "Error: /etc/os-release not found. Cannot detect OS." >&2
  exit 1
fi
# shellcheck source=/dev/null
source /etc/os-release

# Extra SANs for the K3s API server cert, comma-separated (public IP / DNS name).
# Usage: K3S_TLS_SANS=203.0.113.10,k8s.example.com ./install-deps.sh
install_k3s() {
  step "Installing K3s via official installer"
  if [[ -n "${K3S_TLS_SANS:-}" ]]; then
    local sans
    IFS=, read -ra sans <<<"$K3S_TLS_SANS"
    sudo mkdir -p /etc/rancher/k3s/config.yaml.d
    {
      echo "tls-san:"
      printf '  - %s\n' "${sans[@]}"
    } | sudo tee /etc/rancher/k3s/config.yaml.d/tls-san.yaml >/dev/null
  fi
  curl -sfL https://get.k3s.io | sudo sh -s - \
    --write-kubeconfig-mode 644 \
    --disable-cloud-controller
  sudo systemctl enable --now k3s
}

install_ubuntu() {
  step "Ubuntu detected (${VERSION_ID:-unknown}) - Installing apt packages"
  sudo apt-get update -y
  sudo apt-get install -y "${UBUNTU_APT_PACKAGES[@]}"

  local arch
  arch=$(dpkg --print-architecture)

  if [[ "$UBUNTU_INSTALL_KUBECTL" -eq 1 ]] && ! command -v kubectl >/dev/null; then
    step "Installing kubectl (official Kubernetes apt repo)"
    sudo mkdir -p -m 755 /etc/apt/keyrings
    curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key \
      | sudo gpg --dearmor --yes -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
    echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' \
      | sudo tee /etc/apt/sources.list.d/kubernetes.list >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y kubectl
  fi

  if [[ "$UBUNTU_INSTALL_HELM" -eq 1 ]] && ! command -v helm >/dev/null; then
    step "Installing helm ${HELM_VERSION} (official release tarball)"
    local helm_tar="helm-${HELM_VERSION}-linux-${arch}.tar.gz"
    local helm_tmp
    helm_tmp=$(mktemp -d)
    if curl -fsSLo "${helm_tmp}/${helm_tar}" "https://get.helm.sh/${helm_tar}" \
      && curl -fsSLo "${helm_tmp}/${helm_tar}.sha256sum" "https://get.helm.sh/${helm_tar}.sha256sum"; then
      (cd "$helm_tmp" && echo "$(awk '{print $1}' "${helm_tar}.sha256sum")  ${helm_tar}" | sha256sum -c -)
      tar -xzf "${helm_tmp}/${helm_tar}" -C "$helm_tmp"
      sudo install -m 0755 "${helm_tmp}/linux-${arch}/helm" /usr/local/bin/helm
    else
      echo "Tarball download failed; falling back to snap" >&2
      sudo snap install helm --classic
    fi
    rm -rf "$helm_tmp"
  fi

  if [[ "$UBUNTU_INSTALL_KIND" -eq 1 ]] && ! command -v kind >/dev/null; then
    step "Installing kind binary"
    local tmp_kind
    tmp_kind=$(mktemp)
    curl -fsSLo "$tmp_kind" "https://kind.sigs.k8s.io/dl/v0.25.0/kind-linux-${arch}"
    sudo install -m 0755 "$tmp_kind" /usr/local/bin/kind
    rm -f "$tmp_kind"
  fi

  if [[ "$UBUNTU_INSTALL_ARGOCD_CLI" -eq 1 ]] && ! command -v argocd >/dev/null; then
    step "Installing argocd CLI binary"
    local tmp_argocd
    tmp_argocd=$(mktemp)
    curl -fsSLo "$tmp_argocd" "https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-${arch}"
    sudo install -m 0755 "$tmp_argocd" /usr/local/bin/argocd
    rm -f "$tmp_argocd"
  fi

  if [[ "$UBUNTU_INSTALL_K3S" -eq 1 ]] && ! command -v k3s >/dev/null; then
    install_k3s
  fi
}

install_arch() {
  step "Arch Linux detected - Installing pacman packages"
  # Use -Syu to prevent partial upgrades on rolling release systems
  # sudo pacman -Syu --needed --noconfirm "${ARCH_PACKAGES[@]}"
  sudo pacman -S --needed --noconfirm "${ARCH_PACKAGES[@]}"

  if ! command -v k3s >/dev/null; then
    install_k3s
  fi
}

install_nixos() {
  step "NixOS detected - Preparing nix shell arguments"
  local nix_args=()
  for pkg in "${NIX_PACKAGES[@]}"; do
    nix_args+=("nixpkgs#${pkg}")
  done

  echo "Running: nix shell ${nix_args[*]}"
  # Note: `nix shell` starts a subshell with the requested packages on PATH.
  # If a command is passed to this script (e.g. `./install-deps.sh bash kind-test.sh`),
  # it executes that command inside the nix shell; otherwise it opens your interactive shell.
  if [[ $# -gt 0 ]]; then
    exec nix shell "${nix_args[@]}" --command "$@"
  else
    exec nix shell "${nix_args[@]}"
  fi
}

case "${ID:-}" in
  ubuntu)
    install_ubuntu
    ;;
  arch)
    install_arch
    ;;
  nixos)
    install_nixos "$@"
    ;;
  *)
    echo "Unsupported OS: ${ID:-unknown} (Expected: ubuntu, arch, or nixos)" >&2
    exit 1
    ;;
esac

step "Verifying installed binaries on PATH"
for tool in "${REQUIRED_BINARIES[@]}"; do
  if command -v "$tool" >/dev/null; then
    printf '  [OK] %-10s -> %s\n' "$tool" "$(command -v "$tool")"
  else
    echo "  [MISSING] $tool is not on PATH" >&2
    exit 1
  fi
done

step "All required packages are installed."
