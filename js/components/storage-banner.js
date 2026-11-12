import {
  getStorageStatus,
  startEmpty,
  subscribeStorage,
} from "../store.js";

const container = document.getElementById("storage-banner");

const COPY = {
  unreadable: {
    title: "Saved data could not be read",
    text:
      "The hotel data saved in this browser is unreadable, so the desk " +
      "started empty. Nothing has been overwritten, and changes are not " +
      "being saved. Download the saved copy if it matters, or start empty " +
      "to replace it.",
  },
  unavailable: {
    title: "Changes are not being saved",
    text:
      "This browser is not allowing local storage. The app still works in " +
      "this tab, but anything you change will be lost when it closes.",
  },
  "write-failed": {
    title: "Changes are not being saved",
    text:
      "The last change could not be stored. It is visible in this tab, but " +
      "it will be lost if the page reloads. Free up space or allow storage " +
      "for this site, then make another change.",
  },
};

let armedStartEmpty = false;

function downloadFilename() {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return `hotelmanager-saved-data-${stamp}.json`;
}

function download(raw) {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = downloadFilename();
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderUnreadable(status) {
  armedStartEmpty = false;

  const actions = document.createElement("div");
  actions.className = "storage-banner__actions";

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "btn";
  downloadButton.dataset.download = "";
  downloadButton.textContent = "Download saved data";
  downloadButton.disabled = !status.raw;
  downloadButton.addEventListener("click", () => download(status.raw ?? ""));

  const emptyButton = document.createElement("button");
  emptyButton.type = "button";
  emptyButton.className = "btn btn--danger";
  emptyButton.dataset.startEmpty = "";
  emptyButton.textContent = "Start empty";
  emptyButton.addEventListener("click", () => {
    if (!armedStartEmpty) {
      armedStartEmpty = true;
      emptyButton.textContent = "Confirm start empty";
      emptyButton.classList.add("btn--armed");
      emptyButton.setAttribute(
        "aria-label",
        "Confirm start empty and discard the saved data",
      );
      return;
    }

    armedStartEmpty = false;
    startEmpty();
  });

  actions.append(downloadButton, emptyButton);
  return actions;
}

function render() {
  const status = getStorageStatus();

  if (status.kind === "ok") {
    container.hidden = true;
    container.replaceChildren();
    armedStartEmpty = false;
    return;
  }

  const copy = COPY[status.kind] ?? COPY["write-failed"];

  const title = document.createElement("p");
  title.className = "storage-banner__title";
  title.textContent = copy.title;

  const text = document.createElement("p");
  text.className = "storage-banner__text";
  text.textContent = copy.text;

  const children = [title, text];
  if (status.kind === "unreadable") children.push(renderUnreadable(status));

  container.replaceChildren(...children);
  container.hidden = false;
}

subscribeStorage(render);
render();
