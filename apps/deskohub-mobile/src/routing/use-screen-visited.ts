import { useIsFocused } from "expo-router";
import { useState } from "react";

/**
 * Whether the screen has been in front since it mounted. A screen that a
 * navigator mounts before its first visit, such as the Account tab's root
 * (`accountTabOptions`), renders its content from then on, so it reads,
 * renders and announces nothing while another screen is in front.
 */
export const useScreenVisited = (): boolean => {
  const focused = useIsFocused();
  const [visited, setVisited] = useState(focused);
  if (focused && !visited) setVisited(true);
  return visited || focused;
};
