import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDelegate } from "./runtime.ts";

export default function delegateExtension(pi: ExtensionAPI): void {
  registerDelegate(pi);
}
