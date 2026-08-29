import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTask, registerVerification } from "./runtime.ts";

export default function taskExtension(pi: ExtensionAPI): void {
  registerVerification(pi);
  registerTask(pi);
}
