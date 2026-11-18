import { type Locale, m } from "@/features/i18n";

/** The meeting room's specifications in `locale`, in page order. */
export const getMeetingRoomSpecifications = (locale: Locale) =>
  [
    {
      number: "01",
      text: m.meetingRoomSpecCapacityText({}, { locale }),
      title: m.meetingRoomSpecCapacityTitle({}, { locale }),
    },
    {
      number: "02",
      text: m.meetingRoomSpecPrivacyText({}, { locale }),
      title: m.meetingRoomSpecPrivacyTitle({}, { locale }),
    },
    {
      number: "03",
      text: m.meetingRoomSpecWifiText({}, { locale }),
      title: m.meetingRoomSpecWifiTitle({}, { locale }),
    },
    {
      number: "04",
      text: m.meetingRoomSpecAccessText({}, { locale }),
      title: m.meetingRoomSpecAccessTitle({}, { locale }),
    },
  ] as const;
