import type { ReactNode } from "react";
import { cn } from "@/shared/utils";

/**
 * Pictures of the browser and iOS controls the add-to-Home-Screen guide asks
 * the visitor to tap, each with the control to tap ringed. They are
 * decorative: the guide gives screen readers each step in words.
 */

const iosBlue = "#007AFF";
const iosLabel = "#1C1C1E";
const iosSecondary = "#8E8E93";
const chromeGrey = "#5F6368";
const chromeBlue = "#1A73E8";

/** A 24-unit line glyph drawn the way iOS draws its toolbar symbols. */
function Glyph({
  children,
  size = 24,
  color = iosBlue,
  strokeWidth = 1.9,
}: {
  readonly children: ReactNode;
  readonly size?: number;
  readonly color?: string;
  readonly strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden
      fill="none"
      focusable="false"
      height={size}
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

const share = (
  <>
    <path d="M12 15V3M8 6.5 12 2.5l4 4" />
    <path d="M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5" />
  </>
);
const back = <path d="M15 4 7 12l8 8" />;
const forward = <path d="M9 4l8 8-8 8" />;
const bookmarks = (
  <path d="M12 6.5C10 5 7 4.6 3.5 5v13c3.5-.4 6.5 0 8.5 1.5 2-1.5 5-1.9 8.5-1.5V5C17 4.6 14 5 12 6.5Zm0 0V19.5" />
);
const tabs = (
  <>
    <rect height="12" rx="2.5" width="12" x="8" y="4" />
    <path d="M16 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2" />
  </>
);
const addSquare = (
  <>
    <rect height="16" rx="4.5" width="16" x="4" y="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </>
);
const moreHorizontal = (
  <>
    <circle cx="6" cy="12" fill="currentColor" r="1.3" stroke="none" />
    <circle cx="12" cy="12" fill="currentColor" r="1.3" stroke="none" />
    <circle cx="18" cy="12" fill="currentColor" r="1.3" stroke="none" />
  </>
);
const moreVertical = (
  <>
    <circle cx="12" cy="6" fill="currentColor" r="1.6" stroke="none" />
    <circle cx="12" cy="12" fill="currentColor" r="1.6" stroke="none" />
    <circle cx="12" cy="18" fill="currentColor" r="1.6" stroke="none" />
  </>
);
const lock = (
  <>
    <rect height="9" rx="2" width="12" x="6" y="11" />
    <path d="M9 11V8a3 3 0 0 1 6 0v3" />
  </>
);

/** The orange ring around the control to tap. */
function Tap({
  children,
  className,
}: {
  readonly children: ReactNode;
  /** Radius and padding of the ring around this control. */
  readonly className: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center bg-white shadow-[0_0_0_2.5px_#E2570F,0_0_0_7px_rgba(226,87,15,0.18)]",
        className
      )}
    >
      {children}
    </span>
  );
}

const pictureFrame =
  "min-w-0 flex-1 rounded-[14px] bg-[#F2F2F7] text-[#1C1C1E] text-sm leading-[18px]";

/** A five-button toolbar row, like Safari's bottom bar on iPhone. */
const toolbarRow = "flex h-14 items-center justify-around px-1.5";

const glassButton =
  "inline-flex size-9 flex-none items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.14)]";

/** The address field, showing the site's host. */
function Address({ host }: { readonly host: string }) {
  return (
    <span className="flex h-9 min-w-0 flex-1 items-center justify-center gap-[5px] overflow-hidden whitespace-nowrap rounded-full bg-white text-[#1C1C1E] text-xs shadow-[0_1px_4px_rgba(0,0,0,0.14)]">
      <Glyph color={iosSecondary} size={12} strokeWidth={2}>
        {lock}
      </Glyph>
      <span className="min-w-0 truncate">{host}</span>
    </span>
  );
}

/** Safari 18 and earlier on iPhone: Share in the middle of the bottom bar. */
export function SafariToolbarPicture() {
  return (
    <div className={cn(pictureFrame, toolbarRow)}>
      <Glyph>{back}</Glyph>
      <Glyph color="#C7C7CC">{forward}</Glyph>
      <Tap className="rounded-[22px] p-1.5">
        <Glyph>{share}</Glyph>
      </Tap>
      <Glyph>{bookmarks}</Glyph>
      <Glyph>{tabs}</Glyph>
    </div>
  );
}

/** Safari 26 on iPhone: ··· beside the address field at the bottom. */
export function SafariCompactBarPicture({ host }: { readonly host: string }) {
  return (
    <div className={cn(pictureFrame, "flex h-14 items-center gap-2 px-2.5")}>
      <span className={glassButton}>
        <Glyph color={iosLabel} size={20}>
          {back}
        </Glyph>
      </span>
      <Address host={host} />
      <Tap className="rounded-[24px] p-[3px]">
        <span className={cn(glassButton, "text-[#1C1C1E]")}>
          <Glyph color={iosLabel}>{moreHorizontal}</Glyph>
        </span>
      </Tap>
    </div>
  );
}

/** Safari on iPad: Share at the right of the toolbar along the top. */
export function SafariIpadToolbarPicture({ host }: { readonly host: string }) {
  return (
    <div className={cn(pictureFrame, "flex h-14 items-center gap-2 px-2.5")}>
      <Glyph size={20}>{back}</Glyph>
      <Address host={host} />
      <Tap className="rounded-[22px] p-1.5">
        <Glyph>{share}</Glyph>
      </Tap>
      <Glyph size={22}>{tabs}</Glyph>
    </div>
  );
}

/** Chrome on iPhone and iPad: Share inside the address bar. */
export function ChromeAddressBarPicture({ host }: { readonly host: string }) {
  return (
    <div className={cn(pictureFrame, "flex h-14 items-center px-2.5")}>
      <span className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white pr-1.5 pl-3 text-[#1F1F1F] text-xs">
        <Glyph color={chromeGrey} size={12} strokeWidth={2}>
          {lock}
        </Glyph>
        <span className="min-w-0 flex-1 truncate">{host}</span>
        <Tap className="rounded-[18px] p-1">
          <Glyph color={chromeBlue} size={20}>
            {share}
          </Glyph>
        </Tap>
      </span>
    </div>
  );
}

/** Any other iOS browser: Share, or a ··· menu that leads to it. */
export function ShareOrMorePicture({ or }: { readonly or: string }) {
  return (
    <div className={cn(pictureFrame, toolbarRow, "justify-center gap-3.5")}>
      <Tap className="rounded-[22px] p-1.5">
        <Glyph>{share}</Glyph>
      </Tap>
      <span className="text-[#8E8E93] text-xs">{or}</span>
      <Tap className="rounded-[22px] p-1.5">
        <Glyph color={iosLabel}>{moreHorizontal}</Glyph>
      </Tap>
    </div>
  );
}

/** An Android browser: the ⋮ menu beside the address bar. */
export function AndroidToolbarPicture({ host }: { readonly host: string }) {
  return (
    <div className={cn(pictureFrame, "flex h-14 items-center gap-2 px-2.5")}>
      <span className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-full bg-white px-3 text-[#1F1F1F] text-xs">
        <Glyph color={chromeGrey} size={12} strokeWidth={2}>
          {lock}
        </Glyph>
        <span className="min-w-0 flex-1 truncate">{host}</span>
      </span>
      <Tap className="rounded-[22px] p-1.5">
        <Glyph color={chromeGrey}>{moreVertical}</Glyph>
      </Tap>
    </div>
  );
}

export type MenuGlyph = "share" | "add";

/** A placeholder row standing for the menu's other items. */
function OtherMenuItem({ width }: { readonly width: number }) {
  return (
    <span className="flex h-[22px] items-center justify-between gap-2.5 bg-white px-3 first:rounded-t-[10px] last:rounded-b-[10px]">
      <i className="block h-[7px] rounded bg-[#E5E5EA]" style={{ width }} />
      <b className="block size-4 rounded-[5px] bg-[#E5E5EA]" />
    </span>
  );
}

/** A menu or share sheet with the item to tap ringed. */
export function MenuItemPicture({
  label,
  glyph,
}: {
  readonly label: string;
  readonly glyph: MenuGlyph;
}) {
  return (
    <div className={cn(pictureFrame, "flex flex-col p-1.5")}>
      <OtherMenuItem width={92} />
      <span className="relative z-[1] flex min-h-10 items-center justify-between gap-2.5 rounded-[10px] bg-white px-3 py-1.5 text-[15px] shadow-[0_0_0_2.5px_#E2570F,0_0_0_7px_rgba(226,87,15,0.18)]">
        <span className="min-w-0">{label}</span>
        <span className="flex-none">
          <Glyph color={iosLabel} size={22} strokeWidth={1.7}>
            {{ share, add: addSquare }[glyph]}
          </Glyph>
        </span>
      </span>
      <OtherMenuItem width={128} />
    </div>
  );
}

/** The confirmation screen's title with its Add button ringed. */
export function ConfirmPicture({
  title,
  action,
}: {
  readonly title: string;
  readonly action: string;
}) {
  return (
    <div
      className={cn(
        pictureFrame,
        "flex h-[52px] items-center justify-between gap-2 pr-2.5 pl-3.5"
      )}
    >
      <b className="min-w-0 truncate whitespace-nowrap font-semibold text-[13px]">
        {title}
      </b>
      <Tap className="flex-none rounded-[14px] px-2.5 py-[5px]">
        <span className="font-semibold text-[#007AFF] text-[15px]">
          {action}
        </span>
      </Tap>
    </div>
  );
}

/**
 * The step's number, drawn rather than typeset: the digit sits on a fixed
 * baseline, so it stays centred in the circle whatever line metrics the
 * device reads from the font.
 */
export function StepNumber({ step }: { readonly step: number }) {
  return (
    <svg
      aria-hidden
      className="block size-6 flex-none"
      focusable="false"
      height="24"
      viewBox="0 0 24 24"
      width="24"
    >
      <circle cx="12" cy="12" fill="#00024F" r="12" />
      <text
        fill="#fff"
        fontSize="13"
        fontWeight="600"
        style={{ letterSpacing: 0, fontFamily: "var(--font-body)" }}
        textAnchor="middle"
        x={step === 1 ? 12.3 : 12}
        y="16.5"
      >
        {step}
      </text>
    </svg>
  );
}
