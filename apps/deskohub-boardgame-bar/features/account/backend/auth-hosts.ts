import { siteConstants } from "@/shared/utils/constants";

const toHost = (url: string): string =>
  url
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/+.*$/, "")
    .toLowerCase();

/**
 * The exact hosts sign-in links may be issued for: the public site, this
 * Vercel project's production, deployment, and branch hosts, and localhost
 * in development. Anything else is rejected, so a forged Host header can't
 * make the site email a sign-in link that points elsewhere.
 */
export function resolveAuthAllowedHosts(environment: {
  readonly projectProductionUrl: string | undefined;
  readonly deploymentUrl: string | undefined;
  readonly branchUrl: string | undefined;
  readonly development: boolean;
  readonly developmentPort: string | undefined;
}): string[] {
  const candidates = [
    siteConstants.brand.publicDomain,
    environment.projectProductionUrl,
    environment.deploymentUrl,
    environment.branchUrl,
    environment.development
      ? `localhost:${environment.developmentPort || 3000}`
      : undefined,
  ];

  const hosts = candidates
    .filter((url): url is string => Boolean(url))
    .map(toHost)
    .filter((host) => host && !host.includes("*") && !host.includes("?"));

  return [...new Set(hosts)];
}
