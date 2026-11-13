// One polite live region for outcomes that have no visible message of their
// own: a saved booking, a completed check-in, a deleted room. Refusals keep
// their own role="alert" at the point of failure, so this stays quiet unless
// something actually succeeded.
const region = document.createElement("p");
region.className = "visually-hidden";
region.dataset.announcer = "";
region.setAttribute("role", "status");
region.setAttribute("aria-live", "polite");
region.setAttribute("aria-atomic", "true");
document.body.append(region);

export function announce(message) {
  region.textContent = message ?? "";
}
