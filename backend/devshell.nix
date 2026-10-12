{
  pkgs,
  lib,
  pyproject-nix,
  uv2nix,
  pyproject-build-systems,
}: let
  workspace = uv2nix.lib.workspace.loadWorkspace {workspaceRoot = ./.;};

  overlay = workspace.mkPyprojectOverlay {sourcePreference = "wheel";};

  editableOverlay = workspace.mkEditablePyprojectOverlay {root = "$REPO_ROOT";};

  pythonSet =
    (pkgs.callPackage pyproject-nix.build.packages {
      python = pkgs.python314;
    }).overrideScope
    (lib.composeManyExtensions [
      pyproject-build-systems.overlays.wheel
      overlay
    ]);

  virtualenv = (pythonSet.overrideScope editableOverlay).mkVirtualEnv "sts-backend-env" workspace.deps.all;
in
  pkgs.mkShell {
    packages = [virtualenv pkgs.uv];
    env = {
      UV_NO_SYNC = "1";
      UV_PYTHON = pythonSet.python.interpreter;
      UV_PYTHON_DOWNLOADS = "never";
    };
    shellHook = ''
      unset PYTHONPATH
      export REPO_ROOT=$(git rev-parse --show-toplevel)
    '';
  }
