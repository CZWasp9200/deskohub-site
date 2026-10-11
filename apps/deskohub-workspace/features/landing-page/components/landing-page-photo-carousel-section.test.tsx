import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let loadCarouselImages = (): Promise<readonly CloudinaryAsset[]> =>
  Promise.resolve([]);

mock.module("@/features/gallery/backend/get-cloudinary-images.server", () => ({
  getCloudinaryImages: () => loadCarouselImages(),
}));
mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: ({ alt }: { alt: string }) => (
    <span aria-label={alt} role="img" />
  ),
}));
mock.module("yet-another-react-lightbox", () => ({ default: () => null }));

const { LandingPagePhotoCarouselSection } = await import(
  "./landing-page-photo-carousel-section"
);

const syntheticPhotos = [
  {
    context: { custom: { alt: "Synthetic workspace photo 1" } },
    height: 1200,
    public_id: "synthetic-workspace-photo-1",
    secure_url: "https://example.test/synthetic-workspace-photo-1.jpg",
    width: 1600,
  },
  {
    context: { custom: { alt: "Synthetic workspace photo 2" } },
    height: 1200,
    public_id: "synthetic-workspace-photo-2",
    secure_url: "https://example.test/synthetic-workspace-photo-2.jpg",
    width: 1600,
  },
] as const satisfies readonly CloudinaryAsset[];

describe("LandingPagePhotoCarouselSection", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("renders the carousel with the loaded photos", async () => {
    loadCarouselImages = () => Promise.resolve(syntheticPhotos);
    const view = render(
      await LandingPagePhotoCarouselSection({ locale: "en-US" })
    );

    expect(
      view.getByRole("region", {
        name: m.landingCarouselAriaLabel({}, { locale: "en-US" }),
      })
    ).toBeDefined();
    for (const photo of syntheticPhotos) {
      expect(
        view.getAllByRole("img", { name: photo.context.custom.alt })
      ).not.toHaveLength(0);
    }
  });

  test("renders nothing when the photos fail to load", async () => {
    loadCarouselImages = () =>
      Promise.reject(new Error("Cloudinary search failed"));

    expect(
      await LandingPagePhotoCarouselSection({ locale: "en-US" })
    ).toBeNull();
  });

  test("renders nothing when Cloudinary serves no photos", async () => {
    loadCarouselImages = () => Promise.resolve([]);

    expect(
      await LandingPagePhotoCarouselSection({ locale: "en-US" })
    ).toBeNull();
  });
});
