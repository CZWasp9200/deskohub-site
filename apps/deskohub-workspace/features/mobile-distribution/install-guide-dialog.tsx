"use client";

import Interpolate from "@doist/react-interpolate";
import { Portal } from "@radix-ui/react-dialog";
import { type ReactNode, type RefObject, useSyncExternalStore } from "react";
import { type Locale, m } from "@/features/i18n";
import Logo from "@/shared/components/logo/logo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils";
import {
  type InstallGuide,
  type InstallGuideArrow,
  type InstallGuidePictures,
  installGuideArrow,
  installGuidePictures,
  type ScreenOrientation,
} from "./install-guide";
import {
  AndroidToolbarPicture,
  ChromeAddressBarPicture,
  ConfirmPicture,
  MenuItemPicture,
  SafariCompactBarPicture,
  SafariIpadToolbarPicture,
  SafariToolbarPicture,
  ShareOrMorePicture,
  StepNumber,
} from "./install-guide-pictures";

/**
 * The add-to-Home-Screen guide: numbered pictures of what to tap, without
 * prose on screen. Where the browser's toolbar is known, an arrow points at
 * the control for the first step and the sheet keeps clear of it.
 */
export function InstallGuideDialog({
  guide,
  open,
  onOpenChange,
  locale,
  returnFocusTo,
}: {
  readonly guide: InstallGuide;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly locale: Locale;
  /** Where focus goes when the guide closes; the guide has no trigger. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const orientation = useScreenOrientation();
  const arrow = installGuideArrow(guide, orientation);
  const pictures = installGuidePictures(guide);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          "right-2.5 left-2.5 mx-auto flex max-h-[calc(100dvh-24px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-auto max-w-md translate-x-0 flex-col gap-2.5 overflow-y-auto overscroll-contain rounded-[20px] border-0 px-3.5 pt-3 pb-4 shadow-[0_18px_40px_-12px_rgba(0,2,79,0.6)]",
          {
            // Above the arrow pointing down at the bottom toolbar.
            "bottom-center": `top-auto bottom-[calc(52px+env(safe-area-inset-bottom))] ${clearOfArrow}`,
            "bottom-right": `top-auto bottom-[calc(52px+env(safe-area-inset-bottom))] ${clearOfArrow}`,
            // Below the arrow pointing up at the top toolbar.
            "top-right": `top-[52px] ${clearOfArrow}`,
            // No arrow: at the bottom on a phone held upright, else centred.
            none:
              orientation === "portrait"
                ? "top-auto bottom-[calc(12px+env(safe-area-inset-bottom))] translate-y-0"
                : undefined,
          }[arrow ?? "none"],
          // Held sideways the steps sit in two columns, so all of them fit
          // the short viewport without scrolling.
          orientation === "landscape" && "max-w-3xl"
        )}
        locale={locale}
        onCloseAutoFocus={(event) => {
          if (!returnFocusTo?.current) return;
          event.preventDefault();
          returnFocusTo.current.focus();
        }}
        onOpenAutoFocus={(event) => {
          // Start at the sheet rather than its close button.
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus();
          }
        }}
      >
        <div className="flex min-h-8 items-center gap-2.5 pr-9">
          <Logo
            alt=""
            className="h-[29px] w-[26px] flex-none"
            height={29}
            styling={{ color: "light", variant: "color" }}
            width={26}
          />
          <DialogTitle className="flex-1 pr-0 font-semibold! text-[17px] text-navy-blue leading-6">
            {m.installGuideTitle({}, { locale })}
          </DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          {m.installGuideDescription({}, { locale })}
        </DialogDescription>
        <ol
          className={cn(
            "flex flex-col gap-2.5",
            orientation === "landscape" && "grid grid-cols-2 gap-x-4"
          )}
        >
          {guideSteps(pictures, orientation, locale).map((step, index) => (
            <li className="flex items-center gap-2.5" key={step.key}>
              <StepNumber step={index + 1} />
              <span className="sr-only">
                <Interpolate mapping={{ b: <strong /> }} string={step.text} />
              </span>
              <div aria-hidden className="flex min-w-0 flex-1">
                {step.picture}
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
      {arrow && <GuideArrow target={arrow} />}
    </Dialog>
  );
}

/** The sheet's height cap beside an arrow: 52px for the arrow, 12px opposite. */
const clearOfArrow =
  "max-h-[calc(100dvh-64px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] translate-y-0";

type GuideStep = {
  readonly key: string;
  /** The step in words, for screen readers. */
  readonly text: string;
  readonly picture: ReactNode;
};

const guideSteps = (
  pictures: InstallGuidePictures,
  orientation: ScreenOrientation,
  locale: Locale
): readonly GuideStep[] => {
  const host = window.location.host;
  const addToHomeScreenLabel = m.installGuidePictureAddToHomeScreen(
    {},
    { locale }
  );
  const addToHomeScreen: GuideStep = {
    key: "add-to-home-screen",
    text: m.installGuideStepAddToHomeScreen({}, { locale }),
    picture: <MenuItemPicture glyph="add" label={addToHomeScreenLabel} />,
  };
  const add: GuideStep = {
    key: "add",
    text: m.installGuideStepAdd({}, { locale }),
    picture: (
      <ConfirmPicture
        action={m.installGuidePictureAdd({}, { locale })}
        title={addToHomeScreenLabel}
      />
    ),
  };

  switch (pictures) {
    case "safari-iphone-classic":
      return [
        {
          key: "share",
          text: {
            portrait: m.installGuideStepShareBottom({}, { locale }),
            landscape: m.installGuideStepMenuShare({}, { locale }),
          }[orientation],
          picture: <SafariToolbarPicture />,
        },
        addToHomeScreen,
        add,
      ];
    case "safari-iphone-compact":
      return [
        {
          key: "more",
          text: {
            portrait: m.installGuideStepSafariMore({}, { locale }),
            landscape: m.installGuideStepSafariMoreLandscape({}, { locale }),
          }[orientation],
          picture: <SafariCompactBarPicture host={host} />,
        },
        {
          key: "share",
          text: m.installGuideStepMenuShare({}, { locale }),
          picture: (
            <MenuItemPicture
              glyph="share"
              label={m.installGuidePictureShare({}, { locale })}
            />
          ),
        },
        addToHomeScreen,
        add,
      ];
    case "safari-ipad":
      return [
        {
          key: "share",
          text: m.installGuideStepShareTopRight({}, { locale }),
          picture: <SafariIpadToolbarPicture host={host} />,
        },
        addToHomeScreen,
        add,
      ];
    case "chrome-ios":
      return [
        {
          key: "share",
          text: m.installGuideStepShareAddressBar({}, { locale }),
          picture: <ChromeAddressBarPicture host={host} />,
        },
        addToHomeScreen,
        add,
      ];
    case "ios-other":
      return [
        {
          key: "share",
          text: m.installGuideStepGenericMenu({}, { locale }),
          picture: (
            <ShareOrMorePicture or={m.installGuidePictureOr({}, { locale })} />
          ),
        },
        addToHomeScreen,
        add,
      ];
    case "android": {
      const androidAddToHomeScreen =
        m.installGuidePictureAndroidAddToHomeScreen({}, { locale });
      return [
        {
          key: "menu",
          text: m.installGuideStepAndroidMenu({}, { locale }),
          picture: <AndroidToolbarPicture host={host} />,
        },
        {
          key: "add-to-home-screen",
          text: m.installGuideStepAndroidAdd({}, { locale }),
          picture: (
            <MenuItemPicture glyph="add" label={androidAddToHomeScreen} />
          ),
        },
        {
          key: "add",
          text: m.installGuideStepAndroidConfirm({}, { locale }),
          picture: (
            <ConfirmPicture
              action={m.installGuidePictureAndroidAdd({}, { locale })}
              title={androidAddToHomeScreen}
            />
          ),
        },
      ];
    }
  }
};

/**
 * Points out of the sheet at the browser control past the viewport edge.
 * Portalled outside the sheet because the sheet is transformed, which would
 * pin a fixed child to the sheet instead of the viewport. The dialog's own
 * portal renders only while open and never on the server.
 */
function GuideArrow({ target }: { readonly target: InstallGuideArrow }) {
  return (
    <Portal>
      <svg
        aria-hidden
        className={cn(
          "pointer-events-none fixed z-[60] size-11 drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)] duration-300 animate-in fade-in-0",
          {
            "bottom-center":
              "bottom-[calc(4px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2",
            "bottom-right":
              "right-2.5 bottom-[calc(4px+env(safe-area-inset-bottom))]",
            "top-right": "top-1 right-1.5 rotate-180",
          }[target]
        )}
        fill="none"
        focusable="false"
        stroke="#FFC86B"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={4}
        viewBox="0 0 44 44"
      >
        <path d="M22 4v34M10 27l12 12 12-12" />
      </svg>
    </Portal>
  );
}

const orientationQuery = "(orientation: landscape)";

/** The screen orientation, updated as the visitor turns the device. */
const useScreenOrientation = (): ScreenOrientation =>
  useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(orientationQuery);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () =>
      window.matchMedia(orientationQuery).matches ? "landscape" : "portrait",
    () => "portrait"
  );
