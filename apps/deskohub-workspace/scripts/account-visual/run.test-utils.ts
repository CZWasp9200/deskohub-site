import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { runCommand } from "../shared/command";
import type { RgbaImage } from "./metrics";

export const outputRoot = "/tmp/opencode/pr239-account-redesign/visual";
export const repoRoot = resolve(import.meta.dir, "../../../..");
const referencePrefix = "e318512b-b78b-4780-8d86-7dcd43cc3d1f-";
const profileReference = "fab0fa57-710e-4a5c-9807-a8ada402931b.png";
const referenceSuffixes = {
  profile: profileReference,
  billing: "66145089-33ba-4150-92ac-242a4e6f2973.png",
  legal: "0eaa9de2-637f-413f-bdca-98e9dd02650b.png",
  danger: "392b223d-725e-4718-8ea6-6850792317e8.png",
  reservations: "49ca0eec-85be-41bb-a8c6-7cfac690311f.png",
} as const;
const menuReference = "a519a69f-b101-48ec-ba71-e9d4f1218110.png";
const sharp = createRequire(
  join(import.meta.dir, "../../../..", "packages/osm/package.json")
)("sharp");
const syntheticReferenceImage = {
  width: 2560,
  height: 1600,
  data: new Uint8Array(2560 * 1600 * 4).fill(255),
} satisfies RgbaImage;
const syntheticReferencePng = await sharp(
  Buffer.from(syntheticReferenceImage.data),
  {
    raw: {
      width: syntheticReferenceImage.width,
      height: syntheticReferenceImage.height,
      channels: 4,
    },
  }
)
  .png()
  .toBuffer();

export const writeRegressionReference = async (referencesDir: string) => {
  await mkdir(referencesDir, { recursive: true });
  for (const suffix of Object.values(referenceSuffixes)) {
    await writeFile(
      join(referencesDir, `${referencePrefix}${suffix}`),
      syntheticReferencePng
    );
  }
  await writeFile(
    join(referencesDir, `${referencePrefix}${menuReference}`),
    syntheticReferencePng
  );
};

export const runRendererCli = async (argumentsList: readonly string[]) => {
  const { exitCode, signalCode, stdout, stderr, timedOut } = await runCommand(
    [
      process.execPath,
      "run",
      join(import.meta.dir, "run.ts"),
      ...argumentsList,
    ],
    {
      cwd: join(import.meta.dir, "../../../.."),
      env: process.env,
      timeoutMs: 60_000,
    }
  );

  const diagnostics = [stderr, stdout].filter(Boolean).join("\n");
  if (timedOut) {
    throw new Error(
      `Account visual CLI timed out${diagnostics ? `\n${diagnostics}` : ""}`
    );
  }
  if (exitCode !== 0 || signalCode !== null) {
    const termination = signalCode === null ? exitCode : `signal ${signalCode}`;
    throw new Error(
      `Account visual CLI exited with ${termination}: ${diagnostics}`
    );
  }
  const summary = JSON.parse(stdout) as { readonly outputDirectory: string };
  return Bun.file(join(summary.outputDirectory, "report.json")).json();
};
