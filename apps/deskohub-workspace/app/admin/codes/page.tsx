import { Suspense } from "react";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
} from "@/features/administration/components";
import {
  AdministrationActionLoading,
  AdministrationCollectionLoading,
  AdministrationCountLoading,
} from "@/features/administration/loading";
import {
  CodesAdministrationActions,
  CodesAdministrationCollection,
} from "@/features/discounts/admin/components";
import { CoworkTierTargetReleaseProvider } from "@/features/discounts/admin/cowork-tier-target-release";
import {
  type DiscountAdminSearchParams,
  loadDiscountAdminCodesPageData,
} from "@/features/discounts/admin/page-data.server";

export default function DiscountCodesAdminPage({
  searchParams,
}: {
  readonly searchParams: DiscountAdminSearchParams;
}) {
  const data = loadDiscountAdminCodesPageData(searchParams);

  return (
    <AdministrationPage>
      <h1 className="sr-only">Codes</h1>
      <Suspense fallback={null}>
        <CodesNotice data={data} />
      </Suspense>
      <AdministrationTableToolbar
        actions={
          <Suspense
            fallback={<AdministrationActionLoading label="code action" />}
          >
            <CodesActions data={data} />
          </Suspense>
        }
        count={
          <Suspense
            fallback={<AdministrationCountLoading label="discount code" />}
          >
            <CodesCount data={data} />
          </Suspense>
        }
        itemLabel="discount code"
      />
      <Suspense
        fallback={
          <AdministrationCollectionLoading columns={6} label="discount codes" />
        }
      >
        <CodesCollection data={data} />
      </Suspense>
    </AdministrationPage>
  );
}

type CodesData = Awaited<ReturnType<typeof loadDiscountAdminCodesPageData>>;

async function CodesNotice({ data }: { readonly data: Promise<CodesData> }) {
  return <AdministrationNoticeBanner notice={(await data).notice} />;
}

async function CodesActions({ data }: { readonly data: Promise<CodesData> }) {
  const { coworkTierTargetsReleased, dashboard } = await data;
  return (
    <CoworkTierTargetReleaseProvider released={coworkTierTargetsReleased}>
      <CodesAdministrationActions dashboard={dashboard} />
    </CoworkTierTargetReleaseProvider>
  );
}

async function CodesCount({ data }: { readonly data: Promise<CodesData> }) {
  return (
    <AdministrationTableCount
      count={(await data).dashboard.codes.length}
      itemLabel="discount code"
    />
  );
}

async function CodesCollection({
  data,
}: {
  readonly data: Promise<CodesData>;
}) {
  const { coworkTierTargetsReleased, dashboard } = await data;
  return (
    <CoworkTierTargetReleaseProvider released={coworkTierTargetsReleased}>
      <CodesAdministrationCollection dashboard={dashboard} />
    </CoworkTierTargetReleaseProvider>
  );
}
