import { describe, expect, test } from "bun:test";
import { foldSearchText } from "@deskohub/i18n/search-text";
import type { ReactElement } from "react";
import { invoiceCountryCodes } from "../i18n/country-names";
import { BottomSheet } from "./bottom-sheet";
import { LiveMessage } from "./controls";
import { CountryField, CountryPickerSheet } from "./country-field";
import { ListRow } from "./list";
import { SearchField } from "./search-field";
import { SelectField } from "./select-field";
import { elementTree, find, findAll } from "./testing/element-tree";

type RowProps = Parameters<typeof ListRow>[0];

const picked: Array<string> = [];
const onQueryChange = () => undefined;

const sheet = (query: string, value = "CZ") =>
  elementTree(CountryPickerSheet, {
    visible: true,
    title: "title",
    query,
    onQueryChange,
    value,
    detected: "CZ",
    locale: "en-US",
    onPick: (code) => picked.push(code),
    onDismiss: () => undefined,
  });

const rows = (tree: ReturnType<typeof sheet>) =>
  findAll<RowProps>(tree, ListRow) as ReadonlyArray<ReactElement<RowProps>>;

// A row's country: its key, which the tree reads back with a prefix.
const codeOf = (row: ReactElement<RowProps>) =>
  String(row.key).replace(/^.*\$/, "");

const status = (tree: ReturnType<typeof sheet>) =>
  find<Parameters<typeof LiveMessage>[0]>(tree, LiveMessage)?.props;

describe("CountryPickerSheet", () => {
  test("a search field heads the sheet, with the search and its change handler", () => {
    const header = find(sheet("ger"), BottomSheet)?.props.header as
      | ReactElement<Parameters<typeof SearchField>[0]>
      | undefined;
    expect(header?.type).toBe(SearchField);
    expect(header?.props.value).toBe("ger");
    expect(header?.props.onChangeText).toBe(onQueryChange);
    expect(header?.props.placeholder).not.toBe("");
  });

  test("without a search, lists every country with only the chosen one, first, ticked", () => {
    const listed = rows(sheet("", "SK"));
    expect(listed).toHaveLength(invoiceCountryCodes.length);
    expect(listed[0] && codeOf(listed[0])).toBe("SK");
    expect(listed[0]?.props.selected).toBe(true);
    expect(listed.filter((row) => row.props.selected)).toHaveLength(1);
    expect(status(sheet(""))?.message).toBeUndefined();
  });

  test("a search narrows the list to the names containing it", () => {
    const listed = rows(sheet(" SLOV "));
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(invoiceCountryCodes.length);
    expect(
      listed.every((row) => foldSearchText(row.props.label).includes("slov"))
    ).toBe(true);
    expect(listed.map(codeOf)).toContain("SK");
    expect(status(sheet("slov"))?.message).toBeUndefined();
  });

  test("a search without a match lists nothing and says so in a status", () => {
    const tree = sheet("zzzz");
    expect(rows(tree)).toEqual([]);
    const said = status(tree);
    expect(said?.role).toBe("status");
    expect(said?.message?.length).toBeGreaterThan(0);
  });

  test("a row picks its country", () => {
    picked.length = 0;
    rows(sheet("germ"))
      .find((row) => codeOf(row) === "DE")
      ?.props.onPress?.();
    expect(picked).toEqual(["DE"]);
  });
});

describe("CountryField", () => {
  test("shows the chosen country and opens a closed picker with an empty search", () => {
    const tree = elementTree(CountryField, {
      label: "label",
      value: "DE",
      onChange: () => undefined,
      locale: "en-US",
    });
    expect(find(tree, SelectField)?.props.value).not.toBe("DE");
    const picker = find<Parameters<typeof CountryPickerSheet>[0]>(
      tree,
      CountryPickerSheet
    )?.props;
    expect(picker).toMatchObject({
      visible: false,
      query: "",
      value: "DE",
      detected: "CZ",
    });
  });
});
