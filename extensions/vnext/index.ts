import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerContextAndCode } from "./context-code.ts";
import { registerDelegate } from "./delegate.ts";
import { registerTask, registerVerification } from "./task-verify.ts";

export default function vnextExtension(pi: ExtensionAPI): void {
  registerContextAndCode(pi);
  registerVerification(pi);
  registerTask(pi);
  registerDelegate(pi);
}
