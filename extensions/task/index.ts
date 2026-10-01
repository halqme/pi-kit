import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerControlPolicy } from "./control-policy.ts";
import { registerTask, registerVerification } from "./runtime.ts";

export default function taskExtension(pi: ExtensionAPI): void {
  registerControlPolicy(pi);
  registerVerification(pi);
  registerTask(pi);
}
