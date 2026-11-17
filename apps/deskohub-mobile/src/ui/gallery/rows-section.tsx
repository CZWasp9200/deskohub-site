import Bot from "lucide-react-native/icons/bot";
import FileText from "lucide-react-native/icons/file-text";
import Gift from "lucide-react-native/icons/gift";
import LogOut from "lucide-react-native/icons/log-out";
import Mail from "lucide-react-native/icons/mail";
import Receipt from "lucide-react-native/icons/receipt";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Trash2 from "lucide-react-native/icons/trash-2";
import User from "lucide-react-native/icons/user";
import { View } from "react-native";
import { Badge } from "../badge";
import { Card } from "../card";
import { ListGroup, ListRow, SectionHeader } from "../list";
import { Text } from "../text";
import { space } from "../tokens";
import { GalleryCase, GallerySection, useSample } from "./gallery-kit";

const ignore = () => undefined;

/** Board 00c part 7 and the tab root of board 00: cards, rows and headers. */
export function RowsSection() {
  const sample = useSample();
  return (
    <GallerySection title="Cards, rows and section headers">
      <GalleryCase label="Tab root: icon rows with a description, then a headed group">
        <View>
          <ListGroup>
            <ListRow
              label={sample("Profile")}
              description={sample("Name, phone and photo")}
              icon={User}
              onPress={ignore}
            />
            <ListRow
              label={sample("Billing details")}
              description={sample("Personal, for invoices")}
              icon={Receipt}
              onPress={ignore}
            />
            <ListRow
              label={sample("Sign-in and security")}
              description={sample("Email code and 1 passkey")}
              icon={ShieldCheck}
              onPress={ignore}
            />
            <ListRow
              label={sample("Connected assistants")}
              description={sample("None connected")}
              icon={Bot}
              onPress={ignore}
            />
          </ListGroup>
          <SectionHeader title={sample("Rewards")} />
          <ListGroup>
            <ListRow
              label={sample("Invite friends")}
              description={sample("Your discount: 10%")}
              icon={Gift}
              onPress={ignore}
            />
          </ListGroup>
        </View>
      </GalleryCase>
      <GalleryCase label="Section header with a description; external, value and destructive rows">
        <View>
          <SectionHeader
            first
            title={sample("Documents")}
            description={sample("Open on the Deskohub website.")}
          />
          <ListGroup>
            <ListRow
              label={sample("Privacy policy")}
              description={sample("How we use your data")}
              icon={ShieldCheck}
              trailing="external"
              onPress={ignore}
            />
            <ListRow
              label={sample("General terms")}
              icon={FileText}
              trailing="external"
              onPress={ignore}
            />
            <ListRow
              label={sample("Invoices")}
              icon={Receipt}
              value="2"
              onPress={ignore}
            />
            <ListRow
              label={sample("Delete account")}
              icon={Trash2}
              destructive
              onPress={ignore}
            />
          </ListGroup>
        </View>
      </GalleryCase>
      <GalleryCase label="Badge as trailing, an action row, a disabled row">
        <ListGroup>
          <ListRow
            label={sample("Email code")}
            description={sample("We email a one-time code")}
            icon={Mail}
            trailing={<Badge label={sample("Always on")} tone="positive" />}
          />
          <ListRow
            label={sample("Sign out")}
            icon={LogOut}
            kind="action"
            onPress={ignore}
          />
          <ListRow
            label={sample("Connected assistants")}
            description={sample("Sign in again to manage them")}
            icon={Bot}
            disabled
            onPress={ignore}
          />
        </ListGroup>
      </GalleryCase>
      <GalleryCase label="Label and value rows, without icons">
        <ListGroup>
          <ListRow label={sample("Date")} value={sample("Thu 12 Nov")} />
          <ListRow label={sample("Seats")} value="1" />
          <ListRow
            label={sample("Status")}
            trailing={<Badge label={sample("Cancelled")} tone="danger" />}
          />
        </ListGroup>
      </GalleryCase>
      <GalleryCase label="A long value: under the label, or beside it with wrapValue">
        <ListGroup>
          <ListRow
            label={sample("Valid")}
            value={sample("Thu 12 Nov 2026 9:00 – Fri 13 Nov 2026 17:00")}
          />
          <ListRow
            label={sample("Valid")}
            value={sample("Thu 12 Nov 2026 9:00 – Fri 13 Nov 2026 17:00")}
            wrapValue
          />
        </ListGroup>
      </GalleryCase>
      <GalleryCase label="Card">
        <Card>
          <View style={{ gap: space.xs }}>
            <Text variant="headline">{sample("Open Space")}</Text>
            <Text variant="bodySmall">
              {sample("Thursday 26 November 2026, 1 seat")}
            </Text>
          </View>
        </Card>
      </GalleryCase>
    </GallerySection>
  );
}
