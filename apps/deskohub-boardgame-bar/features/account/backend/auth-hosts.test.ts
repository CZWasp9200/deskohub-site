import { describe, expect, it } from "bun:test";
import { resolveAuthAllowedHosts } from "./auth-hosts";

const production = {
  projectProductionUrl: "https://bar.deskohub.cz",
  deploymentUrl: "https://deskohub-bar-abc123.vercel.app/",
  branchUrl: "deskohub-bar-git-feature.vercel.app",
  development: false,
  developmentPort: undefined,
};

describe("resolveAuthAllowedHosts", () => {
  it("lists the public site and the exact Vercel hosts once each", () => {
    expect(resolveAuthAllowedHosts(production)).toEqual([
      "bar.deskohub.cz",
      "deskohub-bar-abc123.vercel.app",
      "deskohub-bar-git-feature.vercel.app",
    ]);
  });

  it("allows localhost only in development", () => {
    expect(resolveAuthAllowedHosts(production)).not.toContain("localhost:3000");
    expect(
      resolveAuthAllowedHosts({
        ...production,
        development: true,
        developmentPort: "3200",
      })
    ).toContain("localhost:3200");
  });

  it("drops wildcard hosts", () => {
    expect(
      resolveAuthAllowedHosts({ ...production, branchUrl: "*.vercel.app" })
    ).not.toContain("*.vercel.app");
  });
});
