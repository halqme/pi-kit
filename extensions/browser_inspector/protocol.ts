export type BrowserTarget =
  | { ref: string }
  | { selector: string }
  | { point: { x: number; y: number } };

export type StylePreset = "layout" | "typography" | "paint" | "all";

export type BrowserCommand =
  | { action: "probe" }
  | {
      action: "open";
      url: string;
      viewport?: { width: number; height: number };
    }
  | { action: "inspect"; target: BrowserTarget }
  | {
      action: "styles";
      target: BrowserTarget;
      properties?: string[];
      preset?: StylePreset;
    }
  | { action: "screenshot"; target?: BrowserTarget; outputPath: string }
  | {
      action: "interact";
      operation: "click" | "type" | "press" | "scroll" | "resize" | "reload" | "back" | "forward";
      target?: BrowserTarget;
      text?: string;
      key?: string;
      dx?: number;
      dy?: number;
      width?: number;
      height?: number;
    }
  | { action: "console"; cursor?: number; levels?: string[] }
  | { action: "network"; cursor?: number; failedOnly?: boolean }
  | { action: "close" };

export interface HostRequest {
  id: number;
  command: BrowserCommand;
}

export type HostResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { message: string; code?: string } };

export interface BrowserHost {
  request(command: BrowserCommand): Promise<unknown>;
  dispose(): Promise<void>;
}
