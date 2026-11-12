import * as frontDesk from "./views/front-desk.js";
import "./components/storage-banner.js";
import { subscribe } from "./store.js";
import { subscribeTick } from "./ticker.js";

const view = document.getElementById("view");

function render() {
  view.replaceChildren(frontDesk.render());
  document.title = frontDesk.title;
}

// Views read from the store directly, so any write has to repaint them.
subscribe(render);

// The day count moves at the 10:00 boundary even when nothing flips.
subscribeTick(render);

render();
