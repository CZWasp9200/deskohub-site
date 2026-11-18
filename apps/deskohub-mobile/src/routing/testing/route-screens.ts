import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { screenPathPattern } from "../../analytics/screen-path";
import { appLinkRoute } from "../app-link";

export const appDir = join(import.meta.dir, "../../../app");

/** Every route file under app/, as segments relative to it, without the extension. */
export const routeFiles = () =>
  readdirSync(appDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) =>
      relative(appDir, join(entry.parentPath, entry.name))
        .replace(/\.tsx?$/, "")
        .split(sep)
    );

/** Screens, without layouts and Expo Router's `+` files such as `+native-intent`. */
export const screens = () =>
  routeFiles().filter(
    (segments) =>
      segments.at(-1) !== "_layout" && !segments.at(-1)?.startsWith("+")
  );

/** Whether a link's path names a screen, matching dynamic segments to any one segment. */
export const resolves = (link: string) => {
  const route = appLinkRoute(link).replace(/^deskohub:\/\//, "/");
  const path = route.split(/[?#]/)[0]?.replace(/\/$/, "") || "/";
  return screens()
    .map(screenPathPattern)
    .some((pattern) =>
      new RegExp(`^${pattern.replace(/\[[^\]/]+\]/g, "[^/]+")}$`).test(path)
    );
};
