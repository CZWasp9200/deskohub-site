import { Effect } from "effect";
import {
  activateHydratedBrowserElement,
  openBrowserPage,
  waitForBrowserCondition,
  waitForBrowserUrl,
} from "../browser";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { log, parseUrl } from "../runtime";
import type { WorkspaceE2ETimeouts } from "../timeouts";
import type { CheckoutData, WorkspaceE2EStepRunner } from "../types";

export const assertLocaleSwitcher = ({
  config,
  run,
  runStep,
  session,
}: {
  config: WorkspaceE2EConfig;
  run: Runner;
  runStep: WorkspaceE2EStepRunner;
  session: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* runStep({
      execute: openBrowserPage(
        config,
        run,
        session,
        `${config.baseUrl}/en-US`,
        { timeoutMs: config.timeouts.browserNavigation }
      ).pipe(Effect.asVoid),
      id: "open-home-page",
      timeoutMs: config.timeouts.browserNavigation,
    });

    yield* runStep({
      execute: switchLocale(run, session, "cs-CZ", config.timeouts),
      id: "switch-to-czech",
      timeoutMs: config.timeouts.browserNavigation,
    });
    yield* runStep({
      execute: switchLocale(run, session, "en-US", config.timeouts),
      id: "switch-to-english",
      timeoutMs: config.timeouts.browserNavigation,
    });

    log("Locale switch e2e passed");
  });

type SwitchLocale = CheckoutData["locale"] | "cs-CZ";

const localeSwitchLinkSelector = (locale: SwitchLocale) =>
  `[data-locale-switcher] a[href^="/${locale}"]`;

/**
 * Whether the switcher link saves the language preference when activated.
 * The header learns that the visitor is signed in from a promise streamed
 * after the shell, so the link hydrates before the saving handler exists. An
 * activation in that window is a guest navigation, and the proxy redirects it
 * straight back to the saved locale. The links carry no attribute for this
 * state, so the check reads the committed props of the switcher component
 * that owns the link: the one that receives `getLocaleHref`.
 */
export const localePreferenceSavingReadyCondition = (locale: SwitchLocale) =>
  `(() => {
    const link = document.querySelector(${JSON.stringify(localeSwitchLinkSelector(locale))});
    if (link === null) return false;
    const fiberKey = Object.keys(link).find((key) => key.startsWith("__reactFiber$"));
    for (let fiber = fiberKey === undefined ? null : link[fiberKey]; fiber != null; fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props !== null && typeof props === "object" && "getLocaleHref" in props) {
        return typeof props.selectLocale === "function";
      }
    }
    return false;
  })()`;

const activateLocaleSwitchLink = (
  run: Runner,
  session: string,
  locale: SwitchLocale,
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    const timeoutMs = timeouts.browserNavigation;
    yield* activateHydratedBrowserElement(
      run,
      session,
      localeSwitchLinkSelector(locale),
      { timeoutMs }
    );
  });

/**
 * Switches a signed-in visitor's locale through the header, which saves the
 * language preference before the document navigation. The URL wait proves
 * the save: without it the proxy would redirect back to the old preference.
 */
export const switchSignedInLocale = (
  run: Runner,
  session: string,
  locale: SwitchLocale,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    yield* waitForBrowserCondition(
      run,
      session,
      `${locale} locale switch saving the preference`,
      localePreferenceSavingReadyCondition(locale),
      { timeoutMs: timeouts.browserNavigation }
    );
    yield* switchLocale(run, session, locale, timeouts);
  });

const switchLocale = (
  run: Runner,
  session: string,
  locale: SwitchLocale,
  timeouts: WorkspaceE2ETimeouts
) =>
  Effect.gen(function* () {
    yield* activateLocaleSwitchLink(run, session, locale, timeouts);
    yield* waitForBrowserUrl({
      description: `${locale} locale switch`,
      matches: (url) =>
        parseUrl(url)?.pathname.startsWith(`/${locale}`) ?? false,
      run,
      session,
      timeoutMs: timeouts.browserNavigation,
    });
  });
