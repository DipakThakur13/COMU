/*
 * Icons.
 *
 * Source: Microsoft Codicons (https://github.com/microsoft/vscode-codicons), the icon set VS Code
 * itself uses. Icons are licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/);
 * see NOTICE.md at the repository root. The SVG sources are imported at build time and inlined, so
 * nothing is fetched at runtime and only the icons actually used reach the bundle.
 *
 * Every glyph draws with `currentColor`, which is the whole point: an icon inherits the theme
 * token of whatever it sits in. Emoji cannot do that, which is why the old interface could not be
 * themed.
 */
import checkSvg from "@vscode/codicons/src/icons/check.svg?raw";
import errorSvg from "@vscode/codicons/src/icons/error.svg?raw";
import warningSvg from "@vscode/codicons/src/icons/warning.svg?raw";
import infoSvg from "@vscode/codicons/src/icons/info.svg?raw";
import syncSvg from "@vscode/codicons/src/icons/sync.svg?raw";
import circleFilledSvg from "@vscode/codicons/src/icons/circle-filled.svg?raw";
import chevronRightSvg from "@vscode/codicons/src/icons/chevron-right.svg?raw";
import chevronDownSvg from "@vscode/codicons/src/icons/chevron-down.svg?raw";
import fileSvg from "@vscode/codicons/src/icons/file.svg?raw";
import diffSvg from "@vscode/codicons/src/icons/diff.svg?raw";
import searchSvg from "@vscode/codicons/src/icons/search.svg?raw";
import terminalSvg from "@vscode/codicons/src/icons/terminal.svg?raw";
import gitCommitSvg from "@vscode/codicons/src/icons/git-commit.svg?raw";
import beakerSvg from "@vscode/codicons/src/icons/beaker.svg?raw";
import debugSvg from "@vscode/codicons/src/icons/debug-alt.svg?raw";
import toolsSvg from "@vscode/codicons/src/icons/tools.svg?raw";
import organizationSvg from "@vscode/codicons/src/icons/organization.svg?raw";
import shieldSvg from "@vscode/codicons/src/icons/shield.svg?raw";
import stopSvg from "@vscode/codicons/src/icons/debug-stop.svg?raw";
import sendSvg from "@vscode/codicons/src/icons/send.svg?raw";
import gearSvg from "@vscode/codicons/src/icons/gear.svg?raw";
import hubotSvg from "@vscode/codicons/src/icons/hubot.svg?raw";
import databaseSvg from "@vscode/codicons/src/icons/database.svg?raw";
import listTreeSvg from "@vscode/codicons/src/icons/list-tree.svg?raw";
import editSvg from "@vscode/codicons/src/icons/edit.svg?raw";
import newFileSvg from "@vscode/codicons/src/icons/new-file.svg?raw";
import closeSvg from "@vscode/codicons/src/icons/close.svg?raw";
import historySvg from "@vscode/codicons/src/icons/history.svg?raw";

const SOURCES = {
  check: checkSvg,
  error: errorSvg,
  warning: warningSvg,
  info: infoSvg,
  sync: syncSvg,
  dot: circleFilledSvg,
  chevronRight: chevronRightSvg,
  chevronDown: chevronDownSvg,
  file: fileSvg,
  diff: diffSvg,
  search: searchSvg,
  terminal: terminalSvg,
  git: gitCommitSvg,
  verification: beakerSvg,
  diagnosis: debugSvg,
  repair: toolsSvg,
  worker: organizationSvg,
  approval: shieldSvg,
  stop: stopSvg,
  send: sendSvg,
  settings: gearSvg,
  agent: hubotSvg,
  memory: databaseSvg,
  plan: listTreeSvg,
  edit: editSvg,
  create: newFileSvg,
  close: closeSvg,
  history: historySvg
} as const;

export type IconName = keyof typeof SOURCES;

/** Strips the outer <svg> so the paths can be placed in an element we control the attributes of. */
const INNER = new Map<IconName, string>(
  (Object.entries(SOURCES) as Array<[IconName, string]>).map(([name, svg]) => [
    name,
    svg.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "")
  ])
);

export interface IconProps {
  name: IconName;
  /** Accessible name. Omit only when the icon is decorative and adjacent text already says it. */
  label?: string;
  size?: number;
  className?: string;
  spin?: boolean;
}

export function Icon({ name, label, size = 14, className, spin }: IconProps) {
  const inner = INNER.get(name) ?? "";
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      style={
        spin
          ? { animation: "comu-spin 1.4s linear infinite", flexShrink: 0 }
          : { flexShrink: 0 }
      }
      // Build-time constant from node_modules, never runtime or model-supplied content.
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
