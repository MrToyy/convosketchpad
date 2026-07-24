/**
 * Banner and formatting utilities for the setup CLI.
 *
 * When CONVOSKETCHPAD_INSTALLER=1 (called from install.sh), uses the same
 * rail + dot visual style as the installer for seamless continuity.
 */

import { packageMetadata } from './package-metadata.js';

const isInstaller = !!process.env.CONVOSKETCHPAD_INSTALLER;

/** Inquirer theme that continues the rail in installer mode */
export const promptTheme = isInstaller
  ? { prefix: `  \x1b[2m│\x1b[0m` }
  : {};

/** Print the setup welcome banner unless the installer already printed it. */
export function printBanner(): void {
  if (isInstaller) return;
  console.log('');
  console.log(`  \x1b[38;5;208m\x1b[1m◆ ConvoSketchpad v${packageMetadata.version}\x1b[0m`);
  console.log(`    \x1b[2m${packageMetadata.description}\x1b[0m`);
  console.log('');
}

const rail = `  \x1b[2m│\x1b[0m`;

/** Print a numbered section header */
export function section(num: number, total: number, title: string): void {
  if (isInstaller) {
    // Sub-step within the installer's Configure stage — lighter style
    console.log(rail);
    console.log(`${rail}  \x1b[38;5;208m▸\x1b[0m \x1b[1m${title}\x1b[0m`);
    console.log(rail);
  } else {
    // Standalone mode — show numbered sections with rail
    if (num > 1) console.log(rail);
    console.log(`  \x1b[38;5;208m●\x1b[0m \x1b[38;5;208m\x1b[1m${title}\x1b[0m  \x1b[2m[${num}/${total}]\x1b[0m`);
    console.log(rail);
  }
}

/** Print a success message with green checkmark */
export function success(msg: string): void {
  console.log(`${rail}  \x1b[32m✓\x1b[0m ${msg}`);
}

/** Print a warning message with orange indicator */
export function warn(msg: string): void {
  console.log(`${rail}  \x1b[38;5;208m⚠\x1b[0m ${msg}`);
}

/** Print a failure message with red X */
export function fail(msg: string): void {
  console.log(`${rail}  \x1b[31m✗\x1b[0m ${msg}`);
}

/** Print an info message with cyan indicator */
export function info(msg: string): void {
  console.log(`${rail}  \x1b[36m○\x1b[0m ${msg}`);
}

/** Print a dim/muted message */
export function dim(msg: string): void {
  console.log(`${rail}  \x1b[2m${msg}\x1b[0m`);
}
