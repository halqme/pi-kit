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
    let created = false;
    try {
      await this.runTmux(["new-session", "-d", "-s", session, "-c", cwd]);
      created = true;
      await this.runTmux(["send-keys", "-t", session, "-l", command]);
      await this.runTmux(["send-keys", "-t", session, "Enter"]);
      return { session, cwd };
    } catch (error) {
      if (created) await this.runTmux(["kill-session", "-t", session]).catch(() => {});
      throw error;
    }
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
