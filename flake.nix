{
  description = "Sync, analyze, and visualize your Claude Code and Codex sessions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    (flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        debrief = pkgs.stdenv.mkDerivation {
          pname = "debrief";
          version = "0.1.0";
          src = ./.;

          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            mkdir -p $out/lib/debrief
            cp -r bin src package.json $out/lib/debrief/
            mkdir -p $out/bin
            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/debrief \
              --add-flags "$out/lib/debrief/bin/debrief.mjs"
          '';
        };
      in {
        packages.default = debrief;
        apps.default = flake-utils.lib.mkApp { drv = debrief; };
      }
    )) // {
      homeManagerModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.programs.debrief;
          jsonFormat = pkgs.formats.json {};
        in {
          options.programs.debrief = {
            enable = lib.mkEnableOption "debrief session archiver";

            package = lib.mkOption {
              type = lib.types.package;
              description = "The debrief package to use";
            };

            archive = lib.mkOption {
              type = lib.types.str;
              default = "${config.xdg.dataHome}/debrief";
              description = "Local path to the session archive directory";
              example = "/home/user/sessions";
            };

            git = {
              remote = lib.mkOption {
                type = lib.types.nullOr lib.types.str;
                default = null;
                description = "Git remote URL. When set, the archive is a git clone managed by debrief.";
                example = "git@github.com:user/sessions.git";
              };
            };
          };

          config = lib.mkIf cfg.enable {
            home.packages = [ cfg.package ];

            xdg.configFile."debrief/config.json".source =
              jsonFormat.generate "debrief-config" (
                { archive = cfg.archive; }
                // lib.optionalAttrs (cfg.git.remote != null) {
                  type = "git";
                  remote = cfg.git.remote;
                }
              );

            home.activation.debriefSetup = lib.mkIf (cfg.git.remote != null) (
              lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                if [ ! -d "${cfg.archive}/.git" ]; then
                  echo "debrief: cloning ${cfg.git.remote} to ${cfg.archive}..."
                  ${pkgs.git}/bin/git clone "${cfg.git.remote}" "${cfg.archive}" 2>/dev/null || {
                    mkdir -p "${cfg.archive}"
                    ${pkgs.git}/bin/git -C "${cfg.archive}" init
                    ${pkgs.git}/bin/git -C "${cfg.archive}" remote add origin "${cfg.git.remote}"
                  }
                fi
                mkdir -p "${cfg.archive}/machines" "${cfg.archive}/facets"
              ''
            );
          };
        };
    };
}
