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
            install -Dm755 bin/debrief-hook.sh $out/bin/debrief-hook
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

          # Cron-to-systemd/launchd helpers (supports *, N, */N fields)
          splitCron = expr:
            let nonEmpty = builtins.filter (s: s != "") (lib.splitString " " expr);
            in {
              minute = builtins.elemAt nonEmpty 0;
              hour   = builtins.elemAt nonEmpty 1;
              dom    = builtins.elemAt nonEmpty 2;
              month  = builtins.elemAt nonEmpty 3;
              dow    = builtins.elemAt nonEmpty 4;
            };

          cronFieldToSystemd = f:
            if f == "*" then "*"
            else if lib.hasPrefix "*/" f then "0/${lib.removePrefix "*/" f}"
            else f;

          dowNames = { "0" = "Sun"; "1" = "Mon"; "2" = "Tue"; "3" = "Wed";
                       "4" = "Thu"; "5" = "Fri"; "6" = "Sat"; "7" = "Sun"; };

          cronToOnCalendar = expr:
            let c = splitCron expr;
                prefix = if c.dow == "*" then "" else "${dowNames.${c.dow}} ";
            in "${prefix}*-${cronFieldToSystemd c.month}-${cronFieldToSystemd c.dom} ${cronFieldToSystemd c.hour}:${cronFieldToSystemd c.minute}:00";

          rangeStep = min: max: step:
            lib.genList (i: min + i * step) ((max - min) / step + 1);

          expandCronField = field: min: max:
            if field == "*" then null
            else if lib.hasPrefix "*/" field then
              rangeStep min max (lib.toInt (lib.removePrefix "*/" field))
            else [ (lib.toInt field) ];

          cronToLaunchdIntervals = expr:
            let
              c = splitCron expr;
              addField = key: values: combos:
                if values == null then combos
                else lib.concatMap (combo: map (v: combo // { ${key} = v; }) values) combos;
            in
              addField "Weekday" (expandCronField c.dow 0 6)
                (addField "Month" (expandCronField c.month 1 12)
                  (addField "Day" (expandCronField c.dom 1 31)
                    (addField "Hour" (expandCronField c.hour 0 23)
                      (addField "Minute" (expandCronField c.minute 0 59)
                        [ {} ]))));
        in {
          options.programs.debrief = {
            enable = lib.mkEnableOption "debrief session archiver";

            package = lib.mkOption {
              type = lib.types.package;
              description = "The debrief package to use";
            };

            archive = lib.mkOption {
              type = lib.types.str;
              default = "${config.xdg.dataHome}/debrief/archive";
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

            schedule = {
              enable = lib.mkEnableOption "scheduled debrief collect";
              cron = lib.mkOption {
                type = lib.types.str;
                default = "0 3 * * *";
                description = "Cron expression for the collection schedule (5-field).";
                example = "0 */6 * * *";
              };
            };
          };

          config = lib.mkIf cfg.enable (lib.mkMerge [
            {
              home.packages = [ cfg.package ];

              xdg.configFile."debrief/config.json".source =
                jsonFormat.generate "debrief-config" (
                  { archive = cfg.archive; }
                  // lib.optionalAttrs (cfg.git.remote != null) {
                    type = "git";
                    remote = cfg.git.remote;
                  }
                );
            }

            (lib.mkIf (cfg.git.remote != null) {
              home.activation.debriefSetup =
                lib.hm.dag.entryAfter [ "writeBoundary" ] ''
                  if [ ! -d "${cfg.archive}/.git" ]; then
                    echo "debrief: cloning ${cfg.git.remote} to ${cfg.archive}..."
                    if ! ${pkgs.git}/bin/git clone "${cfg.git.remote}" "${cfg.archive}"; then
                      echo "debrief: clone failed, initializing fresh repo..."
                      mkdir -p "${cfg.archive}"
                      ${pkgs.git}/bin/git -C "${cfg.archive}" init
                      ${pkgs.git}/bin/git -C "${cfg.archive}" remote add origin "${cfg.git.remote}"
                    fi
                  fi
                  if ! ${pkgs.git}/bin/git -C "${cfg.archive}" rev-parse HEAD >/dev/null 2>&1; then
                    ${pkgs.git}/bin/git -C "${cfg.archive}" fetch origin 2>/dev/null && \
                      ${pkgs.git}/bin/git -C "${cfg.archive}" checkout -b main origin/main 2>/dev/null || true
                  fi
                  mkdir -p "${cfg.archive}/machines" "${cfg.archive}/facets"
                '';
            })

            (lib.mkIf cfg.schedule.enable (
              if pkgs.stdenv.isDarwin then {
                launchd.agents.debrief-collect = {
                  enable = true;
                  config = {
                    Label = "com.debrief.collect";
                    ProgramArguments = [ "${cfg.package}/bin/debrief" "collect" ];
                    StartCalendarInterval = cronToLaunchdIntervals cfg.schedule.cron;
                  };
                };
              } else {
                systemd.user.services.debrief-collect = {
                  Unit.Description = "Debrief session collector";
                  Service = {
                    Type = "oneshot";
                    ExecStart = "${cfg.package}/bin/debrief collect";
                  };
                };
                systemd.user.timers.debrief-collect = {
                  Unit.Description = "Run debrief collect on schedule";
                  Timer = {
                    OnCalendar = cronToOnCalendar cfg.schedule.cron;
                    Persistent = true;
                  };
                  Install.WantedBy = [ "timers.target" ];
                };
              }
            ))
          ]);
        };
    };
}
