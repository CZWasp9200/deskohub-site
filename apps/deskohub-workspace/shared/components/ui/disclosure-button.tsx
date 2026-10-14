import { Button, type ButtonProps } from "./button";

type DisclosureButtonProps = ButtonProps & {
  /** The id of the region this button shows and hides. */
  readonly controls?: string;
  /** Whether the controlled region is currently shown. */
  readonly expanded: boolean;
};

/**
 * A Button that shows or hides a region, such as an inline edit row. It
 * announces its state with `aria-expanded`, so keep its label the same in
 * both states. For a native
 * `<details>` disclosure, style the `<summary>` with `<Button asChild>`.
 */
function DisclosureButton({
  controls,
  expanded,
  type = "button",
  ...props
}: DisclosureButtonProps) {
  return (
    <Button
      {...props}
      aria-controls={controls}
      aria-expanded={expanded}
      type={type}
    />
  );
}

export { DisclosureButton };
