import type { ImageSourcePropType } from "react-native";

/**
 * The owner's meeting-room illustration, shared by the meeting-room screen's
 * header and the Book tab's meeting-room card.
 */
export const meetingRoomIllustration: {
  readonly source: ImageSourcePropType;
  /** Width over height. */
  readonly aspectRatio: number;
  /** The tint the drawing sits on. */
  readonly background: string;
} = {
  source: require("../../../assets/images/booking/meeting-room-illustration.webp"),
  aspectRatio: 900 / 759,
  background: "#EEF2FA",
};
