import {
  runAssociationAudit,
} from "@/lib/cognition-association-audit";
import { createCognitionAuditPost } from "@/lib/cognition-association-audit-route";
import {
  verifyPersistentCognitionSources,
} from "@/lib/ip-cognition-source-verification";

export const POST = createCognitionAuditPost({
  verifySources: verifyPersistentCognitionSources,
  runAudit: (input, candidates) => runAssociationAudit(input, candidates, ""),
});
