/**
 * Show a file in the OS file manager (Finder, Explorer, or the Linux default)
 * without going through a shell.
 *
 * The path is passed to the opener as one argv entry via `execFile`, so shell
 * metacharacters in it (`;`, `&&`, `$(...)`, backticks, quotes) are never
 * interpreted. The caller must pass an absolute path that has already passed
 * containment (see path-containment.ts); an absolute path starts with `/` or
 * a drive letter, so it cannot be read as an option by the opener either.
 */

import { execFile, type ExecFileOptions } from 'node:child_process';
import path from 'node:path';

export interface RevealCommand {
  file: string;
  args: string[];
  options: ExecFileOptions;
  /** Nonzero exit codes that still mean the file manager opened. */
  successExitCodes: number[];
}

export type RevealRunner = (file: string, args: readonly string[], options: ExecFileOptions) => Promise<void>;

const defaultRunner: RevealRunner = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], options, (error) => (error ? reject(error) : resolve()));
  });

/**
 * Seam for tests: route handlers can only export HTTP verbs, so tests swap the
 * runner and platform here instead of launching a real file manager.
 */
export const revealOpener: { platform: NodeJS.Platform; run: RevealRunner } = {
  platform: process.platform,
  run: defaultRunner,
};

/** Build the opener command for `absolutePath` on `platform`. No shell is involved. */
export function buildRevealCommand(platform: NodeJS.Platform, absolutePath: string): RevealCommand {
  if (platform === 'darwin') {
    return { file: 'open', args: ['-R', absolutePath], options: {}, successExitCodes: [] };
  }

  if (platform === 'win32') {
    // explorer.exe parses its own command line and needs `/select,"<path>"`
    // exactly, which Node's default argv quoting does not produce, so the
    // argument is passed verbatim. Windows file names cannot contain `"`, so a
    // quote here could only come from a crafted input; refuse it rather than
    // let it end the quoted path. No cmd.exe runs, so `&`, `|` and `^` are inert.
    if (absolutePath.includes('"')) {
      throw new Error('Refusing to reveal a path that contains a double quote');
    }
    return {
      file: 'explorer.exe',
      args: [`/select,"${absolutePath}"`],
      options: { windowsVerbatimArguments: true },
      // explorer.exe exits with 1 even after it opened the window.
      successExitCodes: [1],
    };
  }

  // Linux and other Unix: open the containing folder.
  return { file: 'xdg-open', args: [path.dirname(absolutePath)], options: {}, successExitCodes: [] };
}

export async function revealInFileManager(absolutePath: string): Promise<void> {
  const { file, args, options, successExitCodes } = buildRevealCommand(revealOpener.platform, absolutePath);
  try {
    await revealOpener.run(file, args, options);
  } catch (error) {
    // execFile reports a nonzero exit as an error whose `code` is the exit code
    // (a number); spawn failures such as ENOENT carry a string code instead.
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number' && successExitCodes.includes(code)) return;
    throw error;
  }
}
