{
  description = "Support Ticketing System";

  inputs = {
    nixpkgs.url = "https://channels.nixos.org/nixos-unstable/nixexprs.tar.xz";

    pyproject-nix = {
      url = "github:pyproject-nix/pyproject.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    uv2nix = {
      url = "github:pyproject-nix/uv2nix";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    pyproject-build-systems = {
      url = "github:pyproject-nix/build-system-pkgs";
      inputs.pyproject-nix.follows = "pyproject-nix";
      inputs.uv2nix.follows = "uv2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    pyproject-nix,
    uv2nix,
    pyproject-build-systems,
    ...
  }: let
    inherit (nixpkgs) lib;
    forAllSystems = lib.genAttrs lib.systems.flakeExposed;
  in {
    # nix develop .#backend   – Python 3.14 / uv
    # nix develop .#frontend  – Node 22 / pnpm
    # nix develop             – combined
    devShells = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
      backendShell = import ./backend/devshell.nix {
        inherit pkgs lib pyproject-nix uv2nix pyproject-build-systems;
      };
      frontendShell = import ./frontend/devshell.nix {inherit pkgs;};
    in {
      backend = backendShell;
      frontend = frontendShell;
      default = pkgs.mkShell {
        inputsFrom = [backendShell frontendShell];
        shellHook = ''
          ${backendShell.shellHook}
          ${frontendShell.shellHook}
        '';
      };
    });
  };
}
