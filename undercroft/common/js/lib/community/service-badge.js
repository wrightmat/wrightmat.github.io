// The icon and the badge for an external account (a username on Roll20, Discord, ...). A service's icon is an
// Iconify name or an https image address; a link pattern turns the badge into a link to the person's page.
import { el } from "../dom.js";

export function renderServiceIcon(icon, size = 16) {
  if (/^https:\/\//.test(icon || "")) {
    const image = el("img", "flex-shrink-0");
    image.src = icon;
    image.alt = "";
    image.width = size;
    image.height = size;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    return image;
  }
  const span = el("span", "iconify flex-shrink-0");
  span.dataset.icon = icon || "tabler:world";
  span.style.fontSize = `${size}px`;
  span.setAttribute("aria-hidden", "true");
  return span;
}

export function accountLink(service, username) {
  return service.linkPattern ? service.linkPattern.replace("{username}", encodeURIComponent(username)) : "";
}

// The icon sits beside the username; the badge itself is a transparent, lightly outlined rectangle.
// An account whose service has been removed from the list has nothing to show, so it renders nothing.
// `onRemove` adds a remove control (the profile editor's chips); a linked badge is not used there.
export function renderAccountBadge(account, services, { onRemove } = {}) {
  const service = services.find((entry) => entry.id === account.serviceId);
  if (!service) return null;
  const href = onRemove ? "" : accountLink(service, account.username);
  const badge = el(href ? "a" : "span", "d-inline-flex align-items-center gap-2 border border-secondary-subtle rounded-3 px-2 py-1 text-body text-decoration-none");
  if (href) {
    badge.href = href;
    badge.target = "_blank";
    badge.rel = "noopener noreferrer";
  }
  badge.title = service.name;
  badge.append(renderServiceIcon(service.icon, 20), el("span", "small", account.username));
  if (onRemove) {
    const remove = el("button", "btn-close ms-1");
    remove.type = "button";
    remove.style.fontSize = "0.55rem";
    remove.setAttribute("aria-label", `Remove ${service.name}`);
    remove.addEventListener("click", onRemove);
    badge.appendChild(remove);
  }
  return badge;
}
