/** The most digits a group of a door PIN holds, so each group reads at a glance. */
const largestGroup = 4;

/**
 * A door PIN split into groups of three or four digits for reading at the
 * keypad: as few groups as fit, the shorter ones first, as the boards show
 * them (seven digits read 380 4276, nine read 380 427 615). The lock issues
 * seven to nine digits; any other length still groups the same way.
 */
export const accessPinGroups = (code: string): ReadonlyArray<string> => {
  const characters = Array.from(code);
  const count = Math.max(1, Math.ceil(characters.length / largestGroup));
  const shorter = Math.floor(characters.length / count);
  const longer = characters.length % count;
  const groups: Array<string> = [];
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    const size = index < count - longer ? shorter : shorter + 1;
    groups.push(characters.slice(at, at + size).join(""));
    at += size;
  }
  return groups;
};

/** The board's digit box at 100% font size, and the gaps around it. */
export const accessPinBox = {
  width: 40,
  height: 60,
  fontSize: 36,
  radius: 12,
  /** Between digits in a group. */
  digitGap: 6,
  /** Between groups. */
  groupGap: 18,
} as const;

/** One digit box's size and its digit's font size, in dp. */
export interface AccessPinBoxSize {
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly radius: number;
}

/**
 * The digit boxes' size for a PIN in `available` dp at the system font size.
 * They grow with the font size; while the PIN fits one line at that size it
 * stays on one line, else its groups wrap whole onto further lines, each
 * group kept on one line. At the default font size a long PIN shrinks a
 * little to stay on one line instead (nine digits at 360 dp). A digit
 * never wraps away from its group and never clips.
 */
export const accessPinBoxSize = (
  groups: ReadonlyArray<string>,
  available: number,
  fontScale: number
): AccessPinBoxSize => {
  const digits = groups.reduce((sum, group) => sum + group.length, 0);
  const longest = Math.max(1, ...groups.map((group) => group.length));
  const wanted = accessPinBox.width * Math.max(fontScale, 1);
  const rowFit =
    (available -
      (digits - groups.length) * accessPinBox.digitGap -
      (groups.length - 1) * accessPinBox.groupGap) /
    Math.max(digits, 1);
  const groupFit =
    (available - (longest - 1) * accessPinBox.digitGap) / longest;
  const oneLine = rowFit >= wanted * shrinkTolerance || fontScale <= 1;
  const width = Math.max(
    1,
    Math.floor(Math.min(wanted, oneLine ? rowFit : groupFit))
  );
  const scale = width / accessPinBox.width;
  return {
    width,
    height: Math.round(accessPinBox.height * scale),
    fontSize: Math.round(accessPinBox.fontSize * scale),
    radius: Math.round(accessPinBox.radius * scale),
  };
};

/** How much a PIN may shrink from its wanted size to stay on one line. */
const shrinkTolerance = 0.85;
