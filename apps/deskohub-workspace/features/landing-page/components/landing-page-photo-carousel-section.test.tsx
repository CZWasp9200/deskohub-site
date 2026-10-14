import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup } from "@testing-library/react";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
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

describe("LandingPagePhotoCarouselSection", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

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
