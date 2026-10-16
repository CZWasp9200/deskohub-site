# Boardgame Bar events

The site publishes upcoming public events in Prague local time: tournaments, game nights and similar occasions guests can plan around.

A dedicated business calendar owns them:

- an entry is published only when its description carries the `[bar:event]` marker, so unmarked entries stay private planning information;
- an entry's title is the public event name, and its remaining description text is the public description;
- optional tags add a price (`[bar:price:...]`), a link to more information (`[bar:link:https://...]`) and a poster (`[bar:image:<Cloudinary public id>]`), and no tag ever appears in the published text;
- a link or poster that is not an absolute `https` address, respectively not a Cloudinary public id, is dropped rather than published; and
- cancelled, malformed and unmarked entries are ignored.

Events stay listed while they are still running, so an evening event does not disappear mid-evening and a multi-day event stays visible until its last day is over. The listing is ordered from the nearest event and rolls over on each Prague calendar day.

The events calendar is optional. Without it, or when it is temporarily unavailable, the page explains that no events are scheduled instead of failing; the rest of the site is unaffected.
