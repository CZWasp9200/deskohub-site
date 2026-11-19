export interface WorkspaceEmailDetail {
  readonly href?: string;
  readonly label: string;
  readonly value: string;
  /** Further values, each on its own line below `value`. */
  readonly lines?: readonly string[];
  /** A muted remark below the values. */
  readonly note?: string;
}

export const renderWorkspaceEmailDetailsText = (
  details: readonly WorkspaceEmailDetail[]
): readonly string[] =>
  details.map(
    ({ label, value, lines = [], note }) =>
      `${label}: ${[value, ...lines].join(", ")}${note ? ` (${note})` : ""}`
  );
