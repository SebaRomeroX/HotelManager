// Every dialog shows its error in one alert paragraph. The show/hide pair
// lives here so a message can never remain visible after its text is cleared,
// and so each sheet keeps the same role="alert" behaviour.
export function showFormError(element, message) {
  element.textContent = message ?? "";
  element.hidden = !message;
}

export function clearFormError(element) {
  element.textContent = "";
  element.hidden = true;
}
