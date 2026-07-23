const CAPTURE_CLICK = true;

function collectElements(root, selector) {
  if (!selector) {
    return [];
  }
  return Array.from(root.querySelectorAll(selector));
}

function getLabelElements(container) {
  return Array.from(container.querySelectorAll("[data-tier-required-label]"));
}

function setHidden(element, hidden) {
  if (!element) {
    return;
  }
  element.classList.toggle("d-none", hidden);
  if (hidden) {
    element.setAttribute("hidden", "true");
    element.setAttribute("aria-hidden", "true");
  } else {
    element.removeAttribute("hidden");
    element.removeAttribute("aria-hidden");
  }
}

function setContentVisibility(elements, visible) {
  elements.forEach((element) => {
    setHidden(element, !visible);
    if (!visible) {
      element.setAttribute("inert", "");
    } else {
      element.removeAttribute("inert");
    }
  });
}

export function initTierGate({
  root = document,
  dataManager = null,
  auth = null,
  status = null,
  requiredTier = "",
  gateSelector = "[data-tier-gate]",
  contentSelector = "[data-tier-content]",
  onGranted = null,
  onRevoked = null,
} = {}) {
  if (!dataManager || typeof dataManager.meetsTier !== "function") {
    throw new Error("initTierGate requires a DataManager instance");
  }

  const gateElements = collectElements(root, gateSelector);
  const contentElements = collectElements(root, contentSelector);
  const labelElements = gateElements.flatMap(getLabelElements);
  const loginButtons = gateElements.flatMap((element) =>
    Array.from(element.querySelectorAll("[data-tier-open-login]"))
  );

  const openLogin = () => {
    if (auth && typeof auth.showLogin === "function") {
      auth.showLogin();
    } else {
      window.dispatchEvent(new CustomEvent("undercroft:open-login"));
    }
  };

  loginButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openLogin();
    });
  });

  const applyLabels = () => {
    const label = dataManager.describeTier(requiredTier) || requiredTier || "";
    labelElements.forEach((element) => {
      if (!label) {
        element.textContent = "";
      } else {
        element.textContent = label;
      }
    });
  };

  const applyState = () => {
    applyLabels();
    const allowed = dataManager.meetsTier(requiredTier);
    setContentVisibility(contentElements, allowed);
    gateElements.forEach((element) => {
      setHidden(element, allowed);
    });
    if (!allowed && status && typeof status.show === "function") {
      const label = dataManager.describeTier(requiredTier) || requiredTier || "";
      const message = label
        ? `This tool requires ${label} access or higher.`
        : "Your tier cannot access this tool.";
      status.show(message, { type: "warning", timeout: 2600 });
    }
    return allowed;
  };

  let allowed = applyState();

  const handleAuthChanged = () => {
    const nextAllowed = applyState();
    if (nextAllowed && !allowed && typeof onGranted === "function") {
      onGranted();
    } else if (!nextAllowed && allowed && typeof onRevoked === "function") {
      onRevoked();
    }
    allowed = nextAllowed;
  };

  window.addEventListener("undercroft:auth-changed", handleAuthChanged);

  return {
    allowed,
    refresh: () => {
      allowed = applyState();
      return allowed;
    },
    dispose: () => {
      window.removeEventListener("undercroft:auth-changed", handleAuthChanged);
    },
  };
}

function updateAccessLabels(element, allowed, label) {
  const targets = element.matches("[data-access-label]")
    ? [element]
    : Array.from(element.querySelectorAll("[data-access-label]"));
  targets.forEach((target) => {
    if (!label) {
      target.textContent = "";
      target.classList.add("d-none");
      return;
    }
    target.textContent = `Requires ${label}`;
    target.classList.toggle("d-none", allowed);
  });
}

function disableElement(element) {
  element.classList.add("opacity-50", "pe-none");
  if (!element.classList.contains("disabled")) {
    element.classList.add("disabled");
  }
  element.setAttribute("aria-disabled", "true");
  if (element.tabIndex >= 0 || element.tagName === "A") {
    if (element.dataset.accessOriginalTabindex === undefined) {
      const current = element.getAttribute("tabindex");
      element.dataset.accessOriginalTabindex = current || "";
    }
    element.setAttribute("tabindex", "-1");
  }
}

function enableElement(element) {
  element.classList.remove("opacity-50", "pe-none", "disabled");
  element.setAttribute("aria-disabled", "false");
  if (element.dataset.accessOriginalTabindex !== undefined) {
    const original = element.dataset.accessOriginalTabindex;
    if (original) {
      element.setAttribute("tabindex", original);
    } else {
      element.removeAttribute("tabindex");
    }
    delete element.dataset.accessOriginalTabindex;
  }
}

function applyElementAccess(element, allowed, label) {
  const behavior = element.dataset.accessBehavior || "disable";
  element.dataset.accessDenied = allowed ? "false" : "true";
  updateAccessLabels(element, allowed, label);
  if (behavior === "hide") {
    element.classList.toggle("d-none", !allowed);
    return;
  }
  if (allowed) {
    enableElement(element);
  } else {
    disableElement(element);
  }
}

export function initTierVisibility({
  root = document,
  dataManager = null,
  status = null,
  auth = null,
} = {}) {
  if (!dataManager || typeof dataManager.meetsTier !== "function") {
    throw new Error("initTierVisibility requires a DataManager instance");
  }

  const elements = Array.from(root.querySelectorAll("[data-requires-tier]"));
  if (!elements.length) {
    return {
      refresh: () => undefined,
      dispose: () => undefined,
    };
  }

  const applyAll = () => {
    elements.forEach((element) => {
      const required = element.dataset.requiresTier || "";
      const allowed = dataManager.meetsTier(required);
      const label = dataManager.describeTier(required) || required || "";
      applyElementAccess(element, allowed, label);
    });
  };

  applyAll();

  const handleAuthChanged = () => {
    applyAll();
  };

  const handleClick = (event) => {
    const trigger = event.target.closest("[data-requires-tier]");
    if (!trigger || !elements.includes(trigger)) {
      return;
    }
    const required = trigger.dataset.requiresTier || "";
    if (!required || dataManager.meetsTier(required)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!dataManager.isAuthenticated()) {
      if (auth && typeof auth.showLogin === "function") {
        auth.showLogin();
      }
    }
    if (status && typeof status.show === "function") {
      const label = dataManager.describeTier(required) || required || "";
      const message = label
        ? `This feature requires ${label} access.`
        : "Your tier cannot access this feature.";
      status.show(message, { type: "warning", timeout: 2600 });
    }
  };

  window.addEventListener("undercroft:auth-changed", handleAuthChanged);
  root.addEventListener("click", handleClick, CAPTURE_CLICK);

  return {
    refresh: applyAll,
    dispose: () => {
      window.removeEventListener("undercroft:auth-changed", handleAuthChanged);
      root.removeEventListener("click", handleClick, CAPTURE_CLICK);
    },
  };
}
