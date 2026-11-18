import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import Check from "lucide-react-native/icons/check";
import Copy from "lucide-react-native/icons/copy";
import Info from "lucide-react-native/icons/info";
import Share2 from "lucide-react-native/icons/share-2";
import { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { systemConfirmsCopy } from "../../platform/clipboard-confirmation";
import { Card } from "../../ui/card";
import { Button, LiveMessage } from "../../ui/controls";
import { Icon } from "../../ui/icon";
import { IconButton } from "../../ui/icon-button";
import { SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Skeleton, SkeletonGroup } from "../../ui/skeleton";
import { Text } from "../../ui/text";
import { useToast } from "../../ui/toast";
import { color, radius, space } from "../../ui/tokens";
import {
  copiedFeedbackMs,
  copyReferralCodeAtom,
  joinedSentence,
  type ReferralDiscountExample,
  type ReferralsView,
  referralsAtom,
  referralsFailure,
  referralsView,
  shareReferralLinkAtom,
} from "./referrals";

const failureMessage = (error: CustomerViewError, locale: AppLocale) => {
  const failure = referralsFailure(error);
  return failure === undefined
    ? undefined
    : {
        "not-released": m.referrals_not_released,
        "summary-unavailable": m.referrals_summary_unavailable,
      }[failure]({}, { locale });
};

/**
 * Invite friends: the customer's invite code to copy and share first, then
 * the discount it earned and what it saved, and how the programme works,
 * every rate as the server's overview gives it.
 */
export function ReferralsScreen() {
  const locale = useAppLocale();
  const referrals = useAtomValue(referralsAtom);
  const refresh = useAtomRefresh(referralsAtom);

  return (
    <ScrollScreen
      refreshing={referrals.waiting && !AsyncResult.isInitial(referrals)}
      onRefresh={refresh}
    >
      <AsyncView
        result={referrals}
        onRetry={refresh}
        errorMessage={(error) => failureMessage(error, locale)}
        loading={<ReferralsSkeleton />}
      >
        {(overview) => (
          <ReferralsSummary view={referralsView(overview, locale)} />
        )}
      </AsyncView>
    </ScrollScreen>
  );
}

/** The loading state: the code card and the two tiles, in their final size. */
function ReferralsSkeleton() {
  const locale = useAppLocale();
  const tile = (
    <Card>
      <View style={styles.tileSkeleton}>
        <Skeleton width="60%" height={10} radius={5} />
        <Skeleton width="50%" height={26} radius={8} />
      </View>
    </Card>
  );
  return (
    <SkeletonGroup label={m.account_loading({}, { locale })}>
      <Card>
        <View style={styles.cardSkeleton}>
          <Skeleton width="34%" height={10} radius={5} />
          <View style={styles.codeRow}>
            <Skeleton width="58%" height={28} radius={8} />
            <View style={styles.spacer} />
            <Skeleton width={48} height={48} radius={24} />
          </View>
          <Skeleton width="100%" height={48} radius={24} />
        </View>
      </Card>
      <View style={styles.tiles}>
        <View style={styles.tile}>{tile}</View>
        <View style={styles.tile}>{tile}</View>
      </View>
    </SkeletonGroup>
  );
}

function ReferralsSummary({ view }: { readonly view: ReferralsView }) {
  const locale = useAppLocale();
  const toast = useToast();
  const copy = useAtomSet(copyReferralCodeAtom, { mode: "promiseExit" });
  const share = useAtomSet(shareReferralLinkAtom, { mode: "promiseExit" });
  const sharing = useAtomValue(shareReferralLinkAtom).waiting;
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<"copy" | "share">();
  const [explained, setExplained] = useState(false);

  // The check goes back to the copy icon on its own.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), copiedFeedbackMs);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyCode = async () => {
    const exit = await copy(view.code);
    if (Exit.isFailure(exit)) {
      setFailure("copy");
      return;
    }
    setFailure(undefined);
    setCopied(true);
    if (!systemConfirmsCopy(Platform)) {
      toast.show({
        message: m.referrals_invite_code_copied({}, { locale }),
        tone: "confirmation",
      });
    }
  };

  const shareLink = async () => {
    const exit = await share({
      url: view.shareUrl,
      message: m.referrals_share_message({ code: view.code }, { locale }),
    });
    setFailure(Exit.isFailure(exit) ? "share" : undefined);
  };

  const savings =
    view.savings.length === 0
      ? new Intl.NumberFormat(locale).format(0)
      : view.savings.join(", ");

  return (
    <>
      <Card>
        <View style={styles.codeCard}>
          <Text variant="caption" tone="muted">
            {m.referrals_code_caption({}, { locale })}
          </Text>
          <View style={styles.codeRow}>
            {/* A code stays on one line, smaller if it has to. */}
            <Text
              selectable
              numeric
              variant="headline"
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
              style={styles.code}
            >
              {view.code}
            </Text>
            <IconButton
              icon={copied ? Check : Copy}
              tone={copied ? "positive" : "tint"}
              label={m.referrals_copy_invite_code({}, { locale })}
              onPress={() => void copyCode()}
            />
          </View>
          <Button
            icon={Share2}
            label={m.referrals_share_invite_link({}, { locale })}
            busy={sharing}
            onPress={() => void shareLink()}
          />
        </View>
      </Card>
      <View style={styles.tiles}>
        <StatTile
          label={m.referrals_your_discount({}, { locale })}
          value={view.discount}
          info={
            view.example === undefined
              ? undefined
              : {
                  label: m.referrals_discount_info({}, { locale }),
                  open: explained,
                  onToggle: () => setExplained((open) => !open),
                }
          }
        />
        <StatTile
          label={m.referrals_saved_so_far({}, { locale })}
          value={savings}
        />
      </View>
      {explained && view.example !== undefined && (
        <DiscountExample example={view.example} />
      )}
      <Text variant="bodySmall" tone="muted" style={styles.joined}>
        {joinedSentence(view.joined, locale)}
      </Text>
      <SectionHeader title={m.referrals_how_it_works({}, { locale })} />
      <View role="list" style={styles.steps}>
        <Step number={1} text={m.referrals_step_share({}, { locale })} />
        <Step
          number={2}
          text={
            view.invitationDiscount === undefined
              ? m.referrals_step_friend({}, { locale })
              : m.referrals_step_friend_rate(
                  { rate: view.invitationDiscount },
                  { locale }
                )
          }
        />
        <Step
          number={3}
          text={
            view.discountPerInvitee === undefined
              ? m.referrals_step_you({}, { locale })
              : m.referrals_step_you_rate(
                  { rate: view.discountPerInvitee },
                  { locale }
                )
          }
        />
      </View>
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="status"
        message={
          copied ? m.referrals_invite_code_copied({}, { locale }) : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          failure === undefined
            ? undefined
            : {
                copy: m.referrals_copy_failed,
                share: m.referrals_share_failed,
              }[failure]({}, { locale })
        }
      />
    </>
  );
}

/** One of the two numbers: a caption over a large figure. */
function StatTile({
  label,
  value,
  info,
}: {
  readonly label: string;
  readonly value: string;
  /** An (i) in the corner that opens how the number is worked out. */
  readonly info?: {
    readonly label: string;
    readonly open: boolean;
    readonly onToggle: () => void;
  };
}) {
  // At large text each tile takes the full width, so no word breaks.
  const stacked = useWindowDimensions().fontScale >= 1.3;
  return (
    <View style={[styles.tile, stacked && styles.tileStacked]}>
      <Card>
        <View style={styles.tileBody}>
          <View style={styles.tileCaption}>
            <Text variant="caption" tone="muted" style={styles.tileLabel}>
              {label}
            </Text>
            {info !== undefined && (
              <Pressable
                role="button"
                aria-label={info.label}
                aria-expanded={info.open}
                onPress={info.onToggle}
                hitSlop={14}
                style={styles.info}
              >
                <Icon icon={Info} size={16} color={color.disabledInk} />
              </Pressable>
            )}
          </View>
          <Text numeric variant="titleLarge" style={styles.figure}>
            {value}
          </Text>
        </View>
      </Card>
    </View>
  );
}

/**
 * The compounding, as a sum: "5% discount" raised to the referrals counted,
 * then the total. The raised count is read as part of one sentence.
 */
function DiscountExample({
  example,
}: {
  readonly example: ReferralDiscountExample;
}) {
  const locale = useAppLocale();
  const count =
    example.referrals === 1
      ? m.referrals_example_one_referral({}, { locale })
      : m.referrals_example_referrals(
          { count: String(example.referrals) },
          { locale }
        );
  return (
    <View
      accessible
      aria-label={m.referrals_example_spoken(
        {
          rate: example.perInvitee,
          count: String(example.referrals),
          total: example.total,
        },
        { locale }
      )}
      style={styles.example}
    >
      <View style={styles.exampleLine}>
        <Text variant="bodySmall" tone="inverse">
          {m.referrals_example_rate({ rate: example.perInvitee }, { locale })}
        </Text>
        <Text variant="caption" tone="inverse" style={styles.raised}>
          {count}
        </Text>
        <Text variant="bodySmall" tone="inverse">
          {m.referrals_example_total({ total: example.total }, { locale })}
        </Text>
      </View>
    </View>
  );
}

function Step({
  number,
  text,
}: {
  readonly number: number;
  readonly text: string;
}) {
  return (
    <View role="listitem" style={styles.step}>
      <View style={styles.stepNumber}>
        <Text variant="label" tone="inverse">
          {String(number)}
        </Text>
      </View>
      <Text variant="body" style={styles.stepText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  codeCard: { gap: space.xs },
  cardSkeleton: { gap: space.sm },
  codeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: space.sm,
    marginBottom: space.md,
  },
  code: {
    color: color.navy,
    flex: 1,
    fontSize: 22,
    letterSpacing: 0.3,
    lineHeight: 32,
    fontWeight: "700",
  },
  spacer: { flex: 1 },
  // Two tiles side by side; at large text each takes the full width.
  tiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.md,
    marginTop: space.lg,
  },
  tile: { flexBasis: 140, flexGrow: 1 },
  tileStacked: { flexBasis: "100%" },
  tileBody: { gap: space.xs },
  tileSkeleton: { gap: space.sm },
  tileCaption: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: space.xs,
  },
  tileLabel: { flex: 1 },
  info: { padding: space.xxs },
  figure: { color: color.navy },
  example: {
    alignSelf: "flex-start",
    backgroundColor: color.navy,
    borderRadius: radius.tile,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + space.xxs,
  },
  // The count sits raised after the rate, like an exponent; the sum wraps
  // as a whole at large text.
  exampleLine: {
    alignItems: "flex-start",
    columnGap: space.xs,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  raised: { fontSize: 10, lineHeight: 12, marginLeft: -space.xxs },
  joined: { paddingTop: space.sm + space.xxs },
  steps: { gap: space.md, paddingHorizontal: space.xs },
  step: { alignItems: "flex-start", flexDirection: "row", gap: space.md },
  stepNumber: {
    alignItems: "center",
    backgroundColor: color.navy,
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  stepText: { color: color.navy, flex: 1, paddingTop: 2 },
});
