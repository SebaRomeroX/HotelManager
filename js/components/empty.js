export function emptySection(title, message) {
  const section = document.createElement("section");

  const heading = document.createElement("h2");
  heading.className = "view__title";
  heading.textContent = title;

  const body = document.createElement("p");
  body.className = "empty";
  body.textContent = message;

  section.append(heading, body);
  return section;
}
