{
  description = "Sync, analyze, and visualize your Claude Code and Codex sessions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        mkDebrief = { archiveDir ? null }: pkgs.stdenv.mkDerivation {
          pname = "debrief";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            mkdir -p $out/lib/debrief
            cp -r bin src package.json $out/lib/debrief/
            mkdir -p $out/bin
            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/debrief \
              --add-flags "$out/lib/debrief/bin/debrief.mjs" \
              ${pkgs.lib.optionalString (archiveDir != null) "--set DEBRIEF_DIR \"${archiveDir}\""}
          '';
        };
      in {
        packages.default = mkDebrief {};
        lib.mkDebrief = mkDebrief;
        apps.default = flake-utils.lib.mkApp { drv = mkDebrief {}; };
      }
    );
}
