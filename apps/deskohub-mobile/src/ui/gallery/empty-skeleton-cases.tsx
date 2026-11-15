import Calendar from "lucide-react-native/icons/calendar";
import CalendarPlus from "lucide-react-native/icons/calendar-plus";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Key from "lucide-react-native/icons/key";
import Receipt from "lucide-react-native/icons/receipt";
import Trash2 from "lucide-react-native/icons/trash-2";
import { View } from "react-native";
import { ErrorState, LoadingState, RefreshingIndicator } from "../async-states";
import { Card } from "../card";
import { Button } from "../controls";
import { EmptyState } from "../empty-state";
import { Skeleton, SkeletonGroup } from "../skeleton";
import { space } from "../tokens";
import { GalleryCase, useSample } from "./gallery-kit";

const ignore = () => undefined;

/** Board 00 components: empty states, skeletons and the async states. */
export function EmptyAndSkeletonCases() {
  const sample = useSample();
  return (
    <>
      <GalleryCase label="Empty state in a card, with its one action">
        <Card padding="none">
          <EmptyState
            icon={Calendar}
            title={sample("No reservations yet")}
            body={sample("Book a desk, a meeting room or a private office.")}
          >
            <Button
              label={sample("Book a workspace")}
              icon={CalendarPlus}
              onPress={ignore}
            />
          </EmptyState>
        </Card>
      </GalleryCase>
      <GalleryCase label="Empty state without a body">
        <Card padding="none">
          <EmptyState icon={Receipt} title={sample("No invoices yet")} />
        </Card>
      </GalleryCase>
      <GalleryCase label="Outlined, action tone">
        <EmptyState
          icon={Key}
          title={sample("No passkeys yet")}
          tone="action"
          dashed
        >
          <Button
            label={sample("Add a passkey")}
            variant="secondary"
            onPress={ignore}
          />
        </EmptyState>
      </GalleryCase>
      <GalleryCase label="Positive, danger and navy tones">
        <Card padding="none">
          <EmptyState
            icon={CircleCheck}
            title={sample("You’re all set, Jana")}
            tone="positive"
          />
        </Card>
        <Card padding="none">
          <EmptyState
            icon={Trash2}
            title={sample("Your account was deleted")}
            tone="danger"
          />
        </Card>
        <Card padding="none">
          <EmptyState
            icon={Calendar}
            title={sample("Book your first workspace")}
            tone="navy"
          />
        </Card>
      </GalleryCase>
      <GalleryCase label="Load error with retry, and retrying">
        <Card padding="none">
          <ErrorState
            message={sample("We couldn’t reach Deskohub")}
            retryLabel={sample("Try again")}
            onRetry={ignore}
          />
        </Card>
        <Card padding="none">
          <ErrorState
            message={sample("We couldn’t reach Deskohub")}
            retryLabel={sample("Try again")}
            onRetry={ignore}
            retrying
          />
        </Card>
      </GalleryCase>
      <GalleryCase label="Skeleton rows in a group">
        <SkeletonGroup rows={3} label={sample("Loading reservations")} />
      </GalleryCase>
      <GalleryCase label="Skeleton blocks in a card">
        <SkeletonGroup label={sample("Loading the reservation")}>
          <Card>
            <View style={{ gap: 10 }}>
              <Skeleton width="40%" height={12} />
              <Skeleton width="75%" height={18} />
              <Skeleton width="55%" height={12} />
            </View>
          </Card>
        </SkeletonGroup>
      </GalleryCase>
      <GalleryCase label="First load, and a background refresh">
        <View style={{ gap: space.md }}>
          <LoadingState label={sample("Loading")} />
          <RefreshingIndicator refreshing label={sample("Refreshing")} />
        </View>
      </GalleryCase>
    </>
  );
}
