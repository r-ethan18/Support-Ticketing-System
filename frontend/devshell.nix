{pkgs}:
  pkgs.mkShell {
    packages = [
      pkgs.nodejs_22
      pkgs.pnpm
    ];
    shellHook = ''
      # pnpm and node are provided by nixpkgs
    '';
  }
