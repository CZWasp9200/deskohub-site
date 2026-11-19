import { Fragment } from "react";
import { Column, Link, Row, Section, Text } from "react-email";
import type { WorkspaceEmailDetail } from "../workspace-email-detail";

export function WorkspaceEmailDetails({
  details,
  wrapWords = false,
}: {
  readonly details: readonly WorkspaceEmailDetail[];
  /**
   * Wraps values between words on narrow screens instead of anywhere, for
   * details that hold sentences, times and addresses rather than long URLs.
   */
  readonly wrapWords?: boolean;
}) {
  return (
    <Section className="mt-6 overflow-hidden rounded-2xl border border-[#e6e9f3]">
      {details.map((detail, index) => (
        <Row
          key={`${detail.label}-${detail.value}`}
          style={{
            borderBottom:
              index === details.length - 1 ? undefined : "1px solid #e6e9f3",
          }}
        >
          <Column className="w-[36%] px-4 py-3 align-top">
            <Text className="m-0 text-[13px] font-bold leading-[20px] text-[#565975]">
              {detail.label}
            </Text>
          </Column>
          <Column className="px-4 py-3 align-top">
            <Text
              className={`m-0 text-[14px] leading-[20px] text-navy ${wrapWords ? "[overflow-wrap:anywhere]" : "break-all sm:break-words"}`}
            >
              {detail.href ? (
                <Link
                  className="text-navy underline"
                  href={detail.href}
                  style={{ color: "#00024f" }}
                >
                  {detail.value}
                </Link>
              ) : (
                detail.value
              )}
              {detail.lines?.map((line) => (
                <Fragment key={line}>
                  <br />
                  {line}
                </Fragment>
              ))}
              {detail.note && (
                <span className="mt-[2px] block text-[13px] text-[#565975]">
                  {detail.note}
                </span>
              )}
            </Text>
          </Column>
        </Row>
      ))}
    </Section>
  );
}
