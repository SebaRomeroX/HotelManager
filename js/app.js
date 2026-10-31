import * as rooms from "./views/rooms.js";
import * as reservations from "./views/reservations.js";
import * as calendar from "./views/calendar.js";
import { subscribe } from "./store.js";

const routes = { rooms, reservations, calendar };
const DEFAULT_ROUTE = "rooms";

const view = document.getElementById("view");
const tabs = [...document.querySelectorAll(".tab")];

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, "");
  return Object.hasOwn(routes, name) ? name : DEFAULT_ROUTE;
}

function render() {
  const name = currentRoute();
  const route = routes[name];

  view.replaceChildren(route.render());
  document.title = `${route.title} — Hotel Manager`;

  for (const tab of tabs) {
    if (tab.getAttribute("href") === `#/${name}`) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }
}

window.addEventListener("hashchange", render);

// Views read from the store directly, so any write has to repaint them.
subscribe(render);

render();
