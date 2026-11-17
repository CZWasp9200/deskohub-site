import { OTPInput, REGEXP_ONLY_DIGITS, type SlotProps } from "input-otp";
import { type CSSProperties, useEffect, useRef } from "react";
import { color, radius, space, typeScale } from "../ui/tokens";

/** How many digits a sign-in code has. */
export const signInCodeLength = 6;

/**
 * The sign-in code as six boxes in two groups of three (the site's pattern),
 * on `input-otp`: one hidden input takes typing, paste and the browser's
 * one-time-code suggestion, so the code fills in from the email or message.
 * It takes digits only. `invalid` rings every box in the error colour;
 * `disabled` greys them out and takes no input, as while the code is checked
 * or once it can no longer work; the boxes take focus again when they
 * re-enable, for another try or a new code. `onComplete` runs when the sixth
 * digit arrives.
 */
export function SignInCodeInput({
  value,
  onChange,
  onComplete,
  label,
  invalid = false,
  disabled = false,
  describedBy,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onComplete?: (value: string) => void;
  /** The accessible name of the input. */
  readonly label: string;
  readonly invalid?: boolean;
  readonly disabled?: boolean;
  /** The id of the message that describes the code's state. */
  readonly describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!disabled) input.current?.focus();
  }, [disabled]);
  return (
    <OTPInput
      ref={input}
      autoFocus
      maxLength={signInCodeLength}
      pattern={REGEXP_ONLY_DIGITS}
      pasteTransformer={(pasted) => pasted.replace(/\D/g, "")}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      render={({ slots }) => (
        <div style={rowStyle}>
          {slots.slice(0, 3).map((slot, index) => (
            <CodeBox
              // biome-ignore lint/suspicious/noArrayIndexKey: the six boxes are fixed positions
              key={index}
              slot={slot}
              invalid={invalid}
              disabled={disabled}
            />
          ))}
          <span aria-hidden="true" style={separatorStyle} />
          {slots.slice(3).map((slot, index) => (
            <CodeBox
              // biome-ignore lint/suspicious/noArrayIndexKey: the six boxes are fixed positions
              key={index + 3}
              slot={slot}
              invalid={invalid}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    />
  );
}

function CodeBox({
  slot,
  invalid,
  disabled,
}: {
  readonly slot: SlotProps;
  readonly invalid: boolean;
  readonly disabled: boolean;
}) {
  const active = slot.isActive && !disabled;
  let ring = `inset 0 0 0 1px ${color.field}`;
  if (active) ring = `inset 0 0 0 2px ${color.action}`;
  if (invalid) ring = `inset 0 0 0 2px ${color.danger}`;
  return (
    <div
      data-code-box=""
      data-active={active}
      style={{
        ...boxStyle,
        boxShadow: ring,
        ...(disabled && {
          backgroundColor: color.disabledField,
          color: color.disabledInk,
        }),
      }}
    >
      {slot.char}
      {slot.hasFakeCaret && !disabled && <span style={caretStyle} />}
    </div>
  );
}

const digitType = typeScale.title;

// The row is a size container, so at a large page zoom (a narrow row) the
// gaps, boxes and digits shrink with it instead of the digits spilling out of
// their boxes; at the board's widths every size stays at its design value.
const rowStyle: CSSProperties = {
  alignItems: "center",
  containerType: "inline-size",
  display: "flex",
  gap: `min(${space.sm}px, 2cqi)`,
  maxWidth: 336,
};

const boxStyle: CSSProperties = {
  alignItems: "center",
  backgroundColor: color.surface,
  borderRadius: radius.tile,
  boxSizing: "border-box",
  color: color.navy,
  display: "flex",
  flex: "1 1 0",
  fontFamily: digitType.fontFamily,
  fontSize: "min(24px, 11cqi)",
  fontVariantNumeric: "tabular-nums",
  fontVariationSettings: digitType.fontVariationSettings,
  fontWeight: 600,
  height: "min(56px, 26cqi)",
  justifyContent: "center",
  maxWidth: 48,
  minWidth: 0,
  position: "relative",
};

const separatorStyle: CSSProperties = {
  backgroundColor: color.ink3,
  display: "block",
  flex: "none",
  height: 2,
  width: 10,
};

const caretStyle: CSSProperties = {
  backgroundColor: color.navy,
  height: "min(24px, 11cqi)",
  position: "absolute",
  width: 1,
};
