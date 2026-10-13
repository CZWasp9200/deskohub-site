import { createRoot } from "react-dom/client";
import { RememberSharedReferralCode } from "./remember-shared-referral-code";

// Mounts the real component on the page Chrome prerendered and reports what
// the shown page remembers once it is activated.
const initiallyPrerendered =
  (document as Document & { readonly prerendering?: boolean }).prerendering ===
  true;
const report = () => {
  // Leave the component's own activation handler time to run first.
  setTimeout(() => {
    void fetch("/evidence", {
      body: JSON.stringify({ cookie: document.cookie, initiallyPrerendered }),
      method: "POST",
    });
  }, 250);
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<RememberSharedReferralCode />);
if (initiallyPrerendered) {
  document.addEventListener("prerenderingchange", report, { once: true });
} else {
  report();
}
