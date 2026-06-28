import type { InstallChoice } from "./pack.js";

/** What an install wrote, recorded under `.backpressure/installed.json`. */
export interface InstalledManifest {
  name: string;
  version: string;
  choice: InstallChoice;
  /** Every written path, relative to the install base dir. */
  files: string[];
  /** The exact hook entries merged in (for clean removal in a later phase). */
  hooks: { event: string; command: string; matcher?: string }[];
}

/** Serialize an {@link InstalledManifest} to the on-disk JSON text. */
export function serializeInstalled(m: InstalledManifest): string {
  return `${JSON.stringify(m, null, 2)}\n`;
}
