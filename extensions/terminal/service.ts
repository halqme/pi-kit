import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type TerminalSession = {
  session: string;
  cwd: string;
};

export type TmuxRunner = (args: string[]) => Promise<void>;

async function systemTmux(args: string[]): Promise<void> {
  await exec("tmux", args);
}

export class TerminalSessionService {
  constructor(private readonly runTmux: TmuxRunner = systemTmux) {}

  async create(command: string, cwd: string): Promise<TerminalSession> {
    const session = `pi-terminal-${randomUUID()}`;
    await this.runTmux(["new-session", "-d", "-s", session, "-c", cwd, command]);
    return { session, cwd };
  }

  async isAlive(session: string): Promise<boolean> {
    try {
      await this.runTmux(["has-session", "-t", session]);
      return true;
    } catch {
      return false;
    }
  }

  async close(session: string): Promise<void> {
    await this.runTmux(["kill-session", "-t", session]);
  }
}
