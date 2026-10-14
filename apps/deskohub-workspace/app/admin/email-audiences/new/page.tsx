import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { AudienceEditorPage } from "@/features/email-campaigns/admin/audiences/audience-editor";
import { authorizeAdministratorPage } from "@/shared/administrator/administrator-authorization.server";

export default function NewEmailAudiencePage() {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <AuthorizedAudienceEditor />
    </Suspense>
  );
}

async function AuthorizedAudienceEditor() {
  await authorizeAdministratorPage();
  return <AudienceEditorPage />;
}
